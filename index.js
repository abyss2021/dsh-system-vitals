/**
 * dsh-system-vitals host half.
 *
 * Owns the sampling loop and the same-origin snapshot route. The readings
 * themselves come from one platform source chosen at load time:
 *
 *   linux  — /proc and /sys kernel counters, no subprocesses
 *   darwin — Node APIs plus `sysctl` / `netstat` / optional `powermetrics`
 *   win32  — one long-lived PowerShell child streaming performance counters
 *
 * Every source returns the same snapshot shape; unsupported fields are null so
 * the Client can render `—` instead of inventing a value.
 */
import os from 'node:os'
import { createSource as createLinuxSource, platform as linuxPlatform } from './platform/linux.js'
import { createSource as createDarwinSource, platform as darwinPlatform } from './platform/darwin.js'
import { createSource as createWindowsSource, platform as windowsPlatform } from './platform/win32.js'

export const name = 'dsh-system-vitals'

/** The Web server is the only requirement: without it there is nothing to serve. */
export const inject = ['webServer']

const API_PREFIX = '/system-vitals/api'

const SOURCES = {
  [linuxPlatform]: createLinuxSource,
  [darwinPlatform]: createDarwinSource,
  [windowsPlatform]: createWindowsSource,
}

/** Platforms with a dedicated source; a missing entry degrades to a Node-only fallback. */
export const supportedPlatforms = Object.keys(SOURCES)

function createFallbackSource() {
  return {
    async read() {
      const total = os.totalmem()
      const free = os.freemem()
      const load = os.loadavg()
      return {
        t: Date.now(),
        host: os.hostname(),
        cpu: { percent: 0, perCore: [], cores: os.cpus().length },
        mem: {
          total,
          used: Math.max(0, total - free),
          percent: total > 0 ? ((total - free) / total) * 100 : 0,
          swapTotal: 0,
          swapUsed: 0,
        },
        load: [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0],
        running: 0,
        tasks: 0,
        count: null,
        uptime: os.uptime(),
        disk: null,
        temperature: null,
        net: null,
      }
    },
  }
}

class Sampler {
  constructor(source, intervalMs) {
    this.source = source
    this.intervalMs = intervalMs
    this.timer = null
    this.pending = false
    this.current = null
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
    this.source.dispose?.()
  }

  async sample() {
    if (this.pending) return
    this.pending = true
    try {
      const point = await this.source.read()
      if (point !== null) {
        this.current = this.current === null ? point : { ...this.current, ...point }
      }
    } catch {
      /* A transient read failure keeps the previous snapshot. */
    } finally {
      this.pending = false
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
  const createSource = SOURCES[process.platform] ?? createFallbackSource
  const sampler = new Sampler(createSource(), intervalMs)

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
          sendJson(response, 200, { now: sampler.current, platform: process.platform })
        },
      }),
    'dsh-system-vitals: route',
  )
}
