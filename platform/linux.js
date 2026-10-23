/**
 * Linux metric source: the kernel's own counters under /proc and /sys.
 */
import { statfs } from 'node:fs/promises'
import os from 'node:os'
import { readText, safeReaddir, toCelsius } from './shared.js'

/** Interfaces whose counters duplicate the physical link's traffic. */
const VIRTUAL_INTERFACE = /^(lo|veth|docker|br-|virbr|tun|tap|wg|zt|tailscale)/

function parseCpuTimes(text) {
  let total = null
  const perCore = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue
    const space = line.indexOf(' ')
    if (space < 0) continue
    const fields = line.slice(space + 1).trim().split(/\s+/).map(Number)
    const idle = (fields[3] ?? 0) + (fields[4] ?? 0)
    const sum = fields.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0)
    const entry = { idle, total: sum }
    if (line.startsWith('cpu ')) total = entry
    else perCore.push(entry)
  }
  return { total, perCore }
}

function parseMeminfo(text) {
  const fields = new Map()
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_()0-9]+):\s+(\d+)/.exec(line)
    if (match !== null) fields.set(match[1], Number(match[2]) * 1024)
  }
  const total = fields.get('MemTotal') ?? 0
  const available = fields.get('MemAvailable') ?? 0
  const swapTotal = fields.get('SwapTotal') ?? 0
  const swapFree = fields.get('SwapFree') ?? 0
  return {
    total,
    used: Math.max(0, total - available),
    percent: total > 0 ? ((total - available) / total) * 100 : 0,
    swapTotal,
    swapUsed: Math.max(0, swapTotal - swapFree),
  }
}

function parseLoadavg(text) {
  const parts = text.trim().split(/\s+/)
  const running = (parts[3] ?? '').split('/')
  return {
    load: [Number(parts[0] ?? 0), Number(parts[1] ?? 0), Number(parts[2] ?? 0)],
    running: Number(running[0] ?? 0) || 0,
    tasks: Number(running[1] ?? 0) || 0,
  }
}

/** Sum received/transmitted bytes over the physical interfaces. */
function parseNetDev(text) {
  let rx = 0
  let tx = 0
  for (const line of text.split('\n')) {
    const match = /^\s*([^:]+):\s*(.+)$/.exec(line)
    if (match === null) continue
    const name = match[1].trim()
    if (VIRTUAL_INTERFACE.test(name)) continue
    const fields = match[2].trim().split(/\s+/).map(Number)
    rx += Number.isFinite(fields[0]) ? fields[0] : 0
    tx += Number.isFinite(fields[8]) ? fields[8] : 0
  }
  return { rx, tx }
}

/** CPU package temperature in °C: hwmon sensors first, thermal zones second. */
async function readTemperature() {
  const preferred = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal', 'cpu-thermal']
  for (const directory of await safeReaddir('/sys/class/hwmon')) {
    const chip = (await readText(`/sys/class/hwmon/${directory}/name`))?.trim()
    if (chip === undefined || chip === '' || !preferred.includes(chip)) continue
    const celsius = toCelsius(await readText(`/sys/class/hwmon/${directory}/temp1_input`))
    if (celsius !== null) return celsius
  }
  let fallback = null
  for (const zone of await safeReaddir('/sys/class/thermal')) {
    if (!zone.startsWith('thermal_zone')) continue
    const celsius = toCelsius(await readText(`/sys/class/thermal/${zone}/temp`))
    if (celsius === null) continue
    const type = (await readText(`/sys/class/thermal/${zone}/type`))?.trim().toLowerCase() ?? ''
    if (/cpu|x86_pkg_temp|soc|package/.test(type)) return celsius
    if (fallback === null) fallback = celsius
  }
  return fallback
}

export const platform = 'linux'

export function createSource() {
  let previousCpu = null
  let previousNet = null
  let taskCount = null
  let ticks = 0

  return {
    async read() {
      ticks += 1
      const [statText, memText, loadText, uptimeText, netText] = await Promise.all([
        readText('/proc/stat'),
        readText('/proc/meminfo'),
        readText('/proc/loadavg'),
        readText('/proc/uptime'),
        readText('/proc/net/dev'),
      ])
      if (statText === null || memText === null) return null

      const t = Date.now()
      const cpu = parseCpuTimes(statText)
      const previous = previousCpu
      previousCpu = cpu
      const cpuPercent = (() => {
        if (previous?.total == null || cpu.total == null) return 0
        const deltaTotal = cpu.total.total - previous.total.total
        if (deltaTotal <= 0) return 0
        const deltaIdle = cpu.total.idle - previous.total.idle
        return ((deltaTotal - deltaIdle) / deltaTotal) * 100
      })()
      const perCore = cpu.perCore.map((core, index) => {
        const before = previous?.perCore?.[index]
        if (before == null) return 0
        const deltaTotal = core.total - before.total
        if (deltaTotal <= 0) return 0
        return ((deltaTotal - (core.idle - before.idle)) / deltaTotal) * 100
      })

      let net = null
      if (netText !== null) {
        const counters = parseNetDev(netText)
        const before = previousNet
        const seconds = before === null ? 0 : (t - before.t) / 1000
        net = {
          rx: before !== null && seconds > 0 ? Math.max(0, (counters.rx - before.rx) / seconds) : 0,
          tx: before !== null && seconds > 0 ? Math.max(0, (counters.tx - before.tx) / seconds) : 0,
        }
        previousNet = { rx: counters.rx, tx: counters.tx, t }
      }

      if (taskCount === null || ticks % 5 === 0) {
        const entries = await safeReaddir('/proc')
        taskCount = entries.reduce((count, entry) => (/^\d+$/.test(entry) ? count + 1 : count), 0)
      }

      const load = loadText === null ? { load: [0, 0, 0], running: 0, tasks: 0 } : parseLoadavg(loadText)
      const mem = parseMeminfo(memText)
      let disk = null
      try {
        const stats = await statfs('/')
        const total = stats.blocks * stats.bsize
        const free = stats.bavail * stats.bsize
        disk = { total, free, used: Math.max(0, total - free), percent: total > 0 ? ((total - free) / total) * 100 : 0 }
      } catch {
        disk = null
      }

      return {
        t,
        host: os.hostname(),
        cpu: { percent: cpuPercent, perCore, cores: cpu.perCore.length || os.cpus().length },
        mem,
        load: load.load,
        running: load.running,
        tasks: load.tasks,
        count: taskCount,
        uptime: uptimeText === null ? 0 : Number(uptimeText.trim().split(/\s+/)[0] ?? 0),
        disk,
        temperature: await readTemperature(),
        net,
      }
    },
  }
}
