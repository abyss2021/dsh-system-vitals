/**
 * dsh-system-vitals host half.
 *
 * Samples the Linux kernel's own counters once per second — CPU (`/proc/stat`),
 * memory (`/proc/meminfo`), load (`/proc/loadavg`), uptime (`/proc/uptime`),
 * network throughput (`/proc/net/dev`), CPU temperature (`/sys/class/hwmon`,
 * then thermal zones) and the root filesystem — then serves the latest snapshot
 * on a same-origin HTTP route.
 *
 * No native module, no shell command, no external dependency.
 */
import { readFile, readdir, statfs } from 'node:fs/promises'
import os from 'node:os'

export const name = 'dsh-system-vitals'

/** The Web server is the only requirement: without it there is nothing to serve. */
export const inject = ['webServer']

const API_PREFIX = '/system-vitals/api'

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

function percentBetween(previous, next) {
  if (previous === null || next === null) return 0
  const deltaTotal = next.total - previous.total
  if (deltaTotal <= 0) return 0
  const deltaIdle = next.idle - previous.idle
  const percent = ((deltaTotal - deltaIdle) / deltaTotal) * 100
  return Math.min(100, Math.max(0, percent))
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function safeReaddir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function readDisk(path) {
  try {
    const stats = await statfs(path)
    const total = stats.blocks * stats.bsize
    const free = stats.bavail * stats.bsize
    return {
      total,
      free,
      used: Math.max(0, total - free),
      percent: total > 0 ? ((total - free) / total) * 100 : 0,
    }
  } catch {
    return null
  }
}

function toCelsius(raw) {
  if (raw === null) return null
  const milli = Number(raw.trim())
  if (!Number.isFinite(milli) || milli <= 0) return null
  return Math.round(milli / 100) / 10
}

/** CPU package temperature in °C: hwmon sensors first, thermal zones second. */
async function readCpuTemperature() {
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

class Sampler {
  constructor(options) {
    this.intervalMs = options.intervalMs
    this.timer = null
    this.pending = false
    this.ticks = 0
    this.current = null
    this.previousCpu = null
    this.previousNet = null
    this.taskCount = null
  }

  start() {
    void this.sample()
    this.timer = setInterval(() => {
      void this.sample()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  dispose() {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  async sample() {
    if (this.pending) return
    this.pending = true
    try {
      const point = await this.read()
      if (point !== null) this.current = point
    } catch {
      /* A transient read failure keeps the previous snapshot. */
    } finally {
      this.pending = false
    }
  }

  async read() {
    const ticks = ++this.ticks
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
    const previous = this.previousCpu
    this.previousCpu = cpu
    const percent = percentBetween(previous?.total ?? null, cpu.total)
    const perCorePercent = cpu.perCore.map((core, index) => percentBetween(previous?.perCore?.[index] ?? null, core))

    let net = null
    if (netText !== null) {
      const counters = parseNetDev(netText)
      const before = this.previousNet
      const seconds = before === null ? 0 : (t - before.t) / 1000
      net = {
        rx: before !== null && seconds > 0 ? Math.max(0, (counters.rx - before.rx) / seconds) : 0,
        tx: before !== null && seconds > 0 ? Math.max(0, (counters.tx - before.tx) / seconds) : 0,
      }
      this.previousNet = { rx: counters.rx, tx: counters.tx, t }
    }

    if (this.taskCount === null || ticks % 5 === 0) {
      const entries = await safeReaddir('/proc')
      this.taskCount = entries.reduce((count, entry) => (/^\d+$/.test(entry) ? count + 1 : count), 0)
    }

    const load = loadText === null ? { load: [0, 0, 0], running: 0, tasks: 0 } : parseLoadavg(loadText)
    const mem = parseMeminfo(memText)
    const disk = await readDisk('/')
    const temperature = await readCpuTemperature()

    return {
      t,
      host: os.hostname(),
      cpu: {
        percent,
        perCore: perCorePercent,
        cores: cpu.perCore.length || os.cpus().length,
      },
      mem,
      load: load.load,
      running: load.running,
      tasks: load.tasks,
      count: this.taskCount,
      uptime: uptimeText === null ? 0 : Number(uptimeText.trim().split(/\s+/)[0] ?? 0),
      disk,
      temperature,
      net,
    }
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  })
  response.end(JSON.stringify(body))
}

export function apply(ctx, config = {}) {
  const intervalMs = Math.min(10000, Math.max(250, Number(config.intervalMs) || 1000))
  const sampler = new Sampler({ intervalMs })

  ctx.effect(() => {
    sampler.start()
    return () => sampler.dispose()
  }, 'dsh-system-vitals: sampler')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          if (url.pathname !== `${API_PREFIX}/snapshot`) {
            sendJson(response, 404, { error: 'not-found' })
            return
          }
          sendJson(response, 200, { now: sampler.current })
        },
      }),
    'dsh-system-vitals: route',
  )
}
