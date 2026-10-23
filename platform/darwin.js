/**
 * macOS metric source.
 *
 * CPU, memory, disk, uptime and host name come from Node APIs and `sysctl`.
 * Throughput comes from `netstat -ib` interface counters. Temperature uses the
 * Apple SMC through `powermetrics` when it is readable without sudo; otherwise
 * the field reports unavailable rather than guessing.
 */
import { statfs } from 'node:fs/promises'
import os from 'node:os'
import { run, toCelsius } from './shared.js'

/** Interfaces whose counters duplicate the physical link's traffic. */
const VIRTUAL_INTERFACE = /^(lo|gif|stf|awdl|llw|utun|bridge|ap|en\d+\.\d+)/

/** Parse `netstat -ib` into per-interface cumulative byte counters. */
function parseNetstat(text) {
  let rx = 0
  let tx = 0
  const seen = new Set()
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 11) continue
    const name = fields[0]
    if (!/^[a-z]+\d+/.test(name) || VIRTUAL_INTERFACE.test(name)) continue
    // Only the first (link-level) row per interface carries the full counters.
    if (seen.has(name)) continue
    const received = Number(fields[6])
    const transmitted = Number(fields[9])
    if (!Number.isFinite(received) || !Number.isFinite(transmitted)) continue
    seen.add(name)
    rx += received
    tx += transmitted
  }
  return { rx, tx }
}

async function readCpuModel() {
  const text = await run('sysctl', ['-n', 'machdep.cpu.brand_string'])
  return text === null ? 'cpu' : text.trim()
}

/** Core count that matches the counters `sysctl` exposes. */
async function readCoreCount() {
  const text = await run('sysctl', ['-n', 'hw.ncpu'])
  const value = text === null ? Number.NaN : Number(text.trim())
  return Number.isInteger(value) && value > 0 ? value : os.cpus().length
}

/**
 * Package temperature in °C. `powermetrics` needs root on modern macOS, so this
 * succeeds only where the binary is readable; `osx-cpu-temp`/`istats` are used
 * as fallbacks when the user happens to have them installed.
 */
async function readTemperature() {
  const powermetrics = await run('powermetrics', ['--samplers', 'smc', '-n', '1', '-i', '1'], 6000)
  if (powermetrics !== null) {
    const match = /CPU die temperature:\s*([\d.]+)/.exec(powermetrics)
    if (match !== null) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) return Math.round(value * 10) / 10
    }
  }
  for (const command of ['osx-cpu-temp', 'istats']) {
    const output = await run(command, command === 'istats' ? ['cpu', 'temp'] : [], 4000)
    if (output === null) continue
    const match = /([\d.]+)\s*°?C/.exec(output)
    if (match === null) continue
    const value = Number(match[1])
    if (Number.isFinite(value) && value > 0) return Math.round(value * 10) / 10
  }
  return null
}

export const platform = 'darwin'

export function createSource() {
  let previousCpu = null
  let previousNet = null
  let coreCount = null
  let cpuModel = null
  let temperature = null
  let ticks = 0

  return {
    async read() {
      ticks += 1
      const t = Date.now()

      if (coreCount === null) coreCount = await readCoreCount()
      if (cpuModel === null) cpuModel = await readCpuModel()

      const cpus = os.cpus()
      const totals = cpus.map((cpu) => {
        const times = cpu.times
        return {
          idle: times.idle,
          total: times.user + times.nice + times.sys + times.idle + times.irq,
        }
      })
      const sum = totals.reduce(
        (acc, entry) => ({ idle: acc.idle + entry.idle, total: acc.total + entry.total }),
        { idle: 0, total: 0 },
      )
      const previous = previousCpu
      previousCpu = { sum, totals }

      const percent = (() => {
        if (previous === null) return 0
        const deltaTotal = sum.total - previous.sum.total
        if (deltaTotal <= 0) return 0
        return ((deltaTotal - (sum.idle - previous.sum.idle)) / deltaTotal) * 100
      })()
      const perCore = totals.map((entry, index) => {
        const before = previous?.totals?.[index]
        if (before === undefined) return 0
        const deltaTotal = entry.total - before.total
        if (deltaTotal <= 0) return 0
        return ((deltaTotal - (entry.idle - before.idle)) / deltaTotal) * 100
      })

      let net = null
      const netstat = await run('netstat', ['-ib'], 5000)
      if (netstat !== null) {
        const counters = parseNetstat(netstat)
        const before = previousNet
        const seconds = before === null ? 0 : (t - before.t) / 1000
        net = {
          rx: before !== null && seconds > 0 ? Math.max(0, (counters.rx - before.rx) / seconds) : 0,
          tx: before !== null && seconds > 0 ? Math.max(0, (counters.tx - before.tx) / seconds) : 0,
        }
        previousNet = { rx: counters.rx, tx: counters.tx, t }
      }

      const memoryTotal = os.totalmem()
      const memoryFree = os.freemem()
      const swap = await run('sysctl', ['-n', 'vm.swapusage'], 4000)
      const swapMatch = swap === null ? null : /total = ([\d.]+)M\s+used = ([\d.]+)M/.exec(swap)

      let disk = null
      try {
        const stats = await statfs('/')
        const total = stats.blocks * stats.bsize
        const free = stats.bavail * stats.bsize
        disk = { total, free, used: Math.max(0, total - free), percent: total > 0 ? ((total - free) / total) * 100 : 0 }
      } catch {
        disk = null
      }

      const loadavg = os.loadavg()
      const cpuInfo = cpus.length > 0 && Number.isFinite(cpus[0].speed) ? `${cpuModel} @ ${cpus[0].speed}MHz` : cpuModel

      return {
        t,
        host: os.hostname(),
        cpu: { percent, perCore, cores: coreCount ?? cpus.length, model: cpuInfo },
        mem: {
          total: memoryTotal,
          used: Math.max(0, memoryTotal - memoryFree),
          percent: memoryTotal > 0 ? ((memoryTotal - memoryFree) / memoryTotal) * 100 : 0,
          swapTotal: swapMatch === null ? 0 : Number(swapMatch[1]) * 1024 * 1024,
          swapUsed: swapMatch === null ? 0 : Number(swapMatch[2]) * 1024 * 1024,
        },
        load: [loadavg[0] ?? 0, loadavg[1] ?? 0, loadavg[2] ?? 0],
        running: 0,
        tasks: 0,
        count: null,
        uptime: os.uptime(),
        disk,
        // `powermetrics` is expensive, so refresh every fifth sample and keep
        // the last reading in between; null means genuinely unavailable.
        temperature: await (async () => {
          if (ticks % 5 === 1 || temperature === null) temperature = await readTemperature()
          return temperature
        })(),
        net,
      }
    },
  }
}
