/**
 * dsh-system-vitals client half.
 *
 * Registers one `conversation.input.left` entry that renders a single
 * always-visible status line — CPU, CPU temperature, memory, disk and live
 * upload/download throughput — inside the composer card's tool row, directly
 * right of the permission control.
 *
 * Layout contract: every reading is the same rigid cell (label · number ·
 * unit), so inter-parameter gaps are identical and the strip never reflows
 * when a digit appears. Numbers hold at most three significant digits; the
 * unit is rescaled (B/s → K/s → M/s) instead of widening the cell. The strip
 * must stay content-sized: giving it inline-size containment inside the
 * content-sized tool cluster collapses it to zero width.
 */
window.__ModuleLoader__.load({
  id: 'dsh-system-vitals',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const NS = 'dsh-system-vitals'
    const ENDPOINT = '/system-vitals/api/snapshot'
    const POLL_MS = 2000

    const zh = {
      cpu: 'CPU',
      temperature: '温度',
      mem: '内存',
      disk: '磁盘',
      upload: '上传',
      download: '下载',
      waiting: '采样中…',
      unavailable: '不可用',
    }

    const en = {
      cpu: 'CPU',
      temperature: 'TEMP',
      mem: 'MEM',
      disk: 'DISK',
      upload: 'UP',
      download: 'DOWN',
      waiting: 'sampling…',
      unavailable: 'n/a',
    }

    const STYLES = `
/* One rigid cell for the composer tool row: 4ch label + 3.5ch number + 2.5ch unit. */
.smx-root{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:10px;
  flex:0 1 auto;min-width:0;overflow:hidden;
  color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
/* Cells total 10ch so the strip keeps its width: label 4ch, value 3ch, unit 3ch.
   The unit cell must fit three characters such as K/s and M/s, so the value
   cell gives up the half character instead of clipping a trailing s. */
.smx-item{display:inline-flex;align-items:baseline;gap:3px;flex:none;width:calc(10ch + 6px)}
.smx-key{flex:none;width:4ch;overflow:hidden;text-align:right;color:var(--dsw-alias-label-tertiary)}
.smx-val{flex:none;width:3ch;text-align:right;color:var(--dsw-alias-label-secondary);font-weight:500}
.smx-unit{flex:none;width:3ch;text-align:left;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.smx-wait{flex:none;white-space:nowrap;color:var(--dsw-alias-label-tertiary);opacity:.85}
/* The composer tool row is itself an inline-size container, so these queries
   measure the card width (not our own, which is content-sized). Narrow cards
   drop secondary readings instead of overflowing the toolbar. */
@container (max-width: 860px){.smx-item[data-priority="3"]{display:none}}
@container (max-width: 620px){.smx-item[data-priority="2"]{display:none}}
`

    /** Compact GiB figure without the unit, e.g. `1` or `0.4`. */
    function formatGiB(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '—'
      const gib = bytes / 1024 / 1024 / 1024
      return gib >= 1 ? String(Math.round(gib)) : String(Math.round(gib * 10) / 10)
    }

    /** Three significant digits at most: `100`, `12`, `2.8`, `0.4`. */
    function threeDigits(value) {
      if (value >= 100) return String(Math.round(value))
      if (value >= 10) return String(Math.round(value))
      if (value === 0) return '0'
      return String(Math.round(value * 10) / 10)
    }

    function splitPercent(value) {
      if (!Number.isFinite(value)) return { number: '—', unit: '%' }
      return { number: threeDigits(Math.max(0, value)), unit: '%' }
    }

    function splitTemperature(value) {
      if (!Number.isFinite(value)) return { number: '—', unit: '°C' }
      return { number: String(Math.round(value)), unit: '°C' }
    }

    /**
     * Pick the unit that keeps the number inside the three-character value cell.
     * Stepping up at 1000 (not at the binary 1024) matters: `1023 B/s` would
     * otherwise print four characters and overflow its cell.
     */
    function splitRate(bytesPerSecond) {
      if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return { number: '—', unit: 'B/s' }
      const units = [
        ['B/s', 1],
        ['K/s', 1024],
        ['M/s', 1024 ** 2],
        ['G/s', 1024 ** 3],
      ]
      let index = 0
      while (index < units.length - 1 && bytesPerSecond / units[index][1] >= 1000) index += 1
      const scaled = Math.min(999, bytesPerSecond / units[index][1])
      return { number: threeDigits(scaled), unit: units[index][0] }
    }

    /** Color escalation shared by every reading in the strip. */
    function tone(value, warn, danger) {
      if (!Number.isFinite(value)) return 'var(--dsw-alias-label-secondary)'
      if (value >= danger) return 'var(--dsw-alias-state-error-primary)'
      if (value >= warn) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-label-secondary)'
    }

    function useSnapshot() {
      const [snapshot, setSnapshot] = useState(null)
      const [failed, setFailed] = useState(false)
      useEffect(() => {
        let alive = true
        const controller = new AbortController()
        const load = async () => {
          try {
            const response = await fetch(ENDPOINT, { cache: 'no-store', signal: controller.signal })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!alive) return
            setSnapshot(body)
            setFailed(false)
          } catch (error) {
            if (!alive || (error && error.name === 'AbortError')) return
            setFailed(true)
          }
        }
        void load()
        const timer = setInterval(() => {
          void load()
        }, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
          controller.abort()
        }
      }, [])
      return { snapshot, failed }
    }

    /** One cell; `title` carries the exact reading a compact cell cannot show. */
    function Item({ label, reading, color, title, priority = 1 }) {
      return h(
        'span',
        { className: 'smx-item', title, 'data-priority': priority },
        h('span', { className: 'smx-key' }, label),
        h('span', { className: 'smx-val', style: color === undefined ? undefined : { color } }, reading.number),
        h('span', { className: 'smx-unit' }, reading.unit),
      )
    }

    function MetricsBar(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const { snapshot, failed } = useSnapshot()
      const now = snapshot && snapshot.now ? snapshot.now : null

      if (now === null) {
        return h('div', { className: 'smx-root' }, h('style', null, STYLES), h('span', { className: 'smx-wait' }, failed ? t('unavailable') : t('waiting')))
      }

      const cpuPercent = now.cpu ? now.cpu.percent : null
      const memory = now.mem ?? null
      const disk = now.disk ?? null
      const net = now.net ?? null

      return h(
        'div',
        { className: 'smx-root' },
        h('style', null, STYLES),
        h(Item, {
          label: t('cpu'),
          reading: splitPercent(cpuPercent),
          color: tone(cpuPercent, 75, 90),
          title: `CPU ${Number.isFinite(cpuPercent) ? Math.round(cpuPercent * 10) / 10 : '—'}%`,
          priority: 1,
        }),
        h(Item, {
          label: t('temperature'),
          reading: splitTemperature(now.temperature),
          color: tone(now.temperature, 80, 92),
          title: Number.isFinite(now.temperature) ? `${now.temperature}°C` : undefined,
          priority: 1,
        }),
        h(Item, {
          label: t('mem'),
          reading: splitPercent(memory?.percent),
          color: tone(memory?.percent, 80, 92),
          title: memory ? `${formatGiB(memory.used)}G / ${formatGiB(memory.total)}G` : undefined,
          priority: 1,
        }),
        h(Item, {
          label: t('disk'),
          reading: splitPercent(disk?.percent),
          color: tone(disk?.percent, 85, 95),
          title: disk ? `${formatGiB(disk.used)}G / ${formatGiB(disk.total)}G` : undefined,
          priority: 2,
        }),
        h(Item, {
          label: t('upload'),
          reading: splitRate(net ? net.tx : Number.NaN),
          title: net ? `${Math.round(net.tx / 1024)} KB/s` : undefined,
          priority: 3,
        }),
        h(Item, {
          label: t('download'),
          reading: splitRate(net ? net.rx : Number.NaN),
          title: net ? `${Math.round(net.rx / 1024)} KB/s` : undefined,
          priority: 3,
        }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh,
              en,
            }),
          'dsh-system-vitals: locale',
        )
        // Inside the composer card's tool row, immediately right of the
        // permission control (自动审查): `conversation.input.left` renders right
        // after `conversation.input.permission`.
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'system-vitals',
              order: 0,
              locale: NS,
            },
            MetricsBar,
          ),
        )
      },
    }
  },
})
