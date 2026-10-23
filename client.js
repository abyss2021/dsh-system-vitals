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
 *
 * Interaction: a cell can be selected (click, Enter or Space) and dragged to a
 * new slot, or moved with the arrow keys while focused. Cells are equal width
 * and stay in the flex row with no placeholder, so reordering never changes the
 * strip's own width or position — only which reading occupies which slot.
 */
window.__ModuleLoader__.load({
  id: 'dsh-system-vitals',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-system-vitals'
    const ENDPOINT = '/system-vitals/api/snapshot'
    const POLL_MS = 2000
    const STORAGE_KEY = 'dsh-system-vitals:order'

    /** Slot order and the identity of every metric; also the restore fallback. */
    const DEFAULT_ORDER = ['cpu', 'temperature', 'mem', 'disk', 'upload', 'download']

    const zh = {
      cpu: 'CPU',
      temperature: '温度',
      mem: '内存',
      disk: '磁盘',
      upload: '上传',
      download: '下载',
      waiting: '采样中…',
      unavailable: '不可用',
      reorderHint: '拖动或用左右方向键调整顺序',
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
      reorderHint: 'Drag or use the arrow keys to reorder',
    }

    const STYLES = `
/* One rigid cell for the composer tool row: 4ch label + 3ch number + 3ch unit. */
.smx-root{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;gap:10px;
  flex:0 1 auto;min-width:0;overflow:hidden;
  color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
.smx-item{display:inline-flex;align-items:baseline;gap:3px;flex:none;width:calc(10ch + 6px);
  border-radius:4px;cursor:grab;user-select:none;transition:background-color .12s ease,box-shadow .12s ease}
.smx-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.smx-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.smx-item[data-selected="true"]{box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.smx-item[data-dragging="true"]{cursor:grabbing;opacity:.55}
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

    /** Stored order, reconciled against the metrics this build knows. */
    function readOrder() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return DEFAULT_ORDER
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return DEFAULT_ORDER
        const known = parsed.filter((id) => DEFAULT_ORDER.includes(id))
        const missing = DEFAULT_ORDER.filter((id) => !known.includes(id))
        return [...new Set(known), ...missing]
      } catch {
        return DEFAULT_ORDER
      }
    }

    function moveSlot(order, from, to) {
      if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order
      const next = [...order]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
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

    function MetricsBar(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const { snapshot, failed } = useSnapshot()
      const [order, setOrder] = useState(readOrder)
      const [selected, setSelected] = useState(null)
      const [dragging, setDragging] = useState(null)
      // Slot index being dragged, kept in a ref so drag handlers always read the
      // newest value without waiting for a re-render.
      const dragFrom = useRef(null)

      const persist = useCallback((next) => {
        setOrder(next)
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          /* A blocked localStorage keeps the order for this session only. */
        }
      }, [])

      const now = snapshot && snapshot.now ? snapshot.now : null
      const cpuPercent = now && now.cpu ? now.cpu.percent : null
      const memory = now ? now.mem ?? null : null
      const disk = now ? now.disk ?? null : null
      const net = now ? now.net ?? null : null

      /** Everything the renderer needs per metric, keyed by slot id. */
      const metrics = {
        cpu: {
          label: t('cpu'),
          reading: splitPercent(cpuPercent),
          color: tone(cpuPercent, 75, 90),
          title: `CPU ${Number.isFinite(cpuPercent) ? Math.round(cpuPercent * 10) / 10 : '—'}%`,
          priority: 1,
        },
        temperature: {
          label: t('temperature'),
          reading: splitTemperature(now ? now.temperature : Number.NaN),
          color: tone(now ? now.temperature : Number.NaN, 80, 92),
          title: now && Number.isFinite(now.temperature) ? `${now.temperature}°C` : undefined,
          priority: 1,
        },
        mem: {
          label: t('mem'),
          reading: splitPercent(memory ? memory.percent : Number.NaN),
          color: tone(memory ? memory.percent : Number.NaN, 80, 92),
          title: memory ? `${formatGiB(memory.used)}G / ${formatGiB(memory.total)}G` : undefined,
          priority: 1,
        },
        disk: {
          label: t('disk'),
          reading: splitPercent(disk ? disk.percent : Number.NaN),
          color: tone(disk ? disk.percent : Number.NaN, 85, 95),
          title: disk ? `${formatGiB(disk.used)}G / ${formatGiB(disk.total)}G` : undefined,
          priority: 2,
        },
        upload: {
          label: t('upload'),
          reading: splitRate(net ? net.tx : Number.NaN),
          title: net ? `${Math.round(net.tx / 1024)} KB/s` : undefined,
          priority: 3,
        },
        download: {
          label: t('download'),
          reading: splitRate(net ? net.rx : Number.NaN),
          title: net ? `${Math.round(net.rx / 1024)} KB/s` : undefined,
          priority: 3,
        },
      }

      if (now === null) {
        return h(
          'div',
          { className: 'smx-root' },
          h('style', null, STYLES),
          h('span', { className: 'smx-wait' }, failed ? t('unavailable') : t('waiting')),
        )
      }

      const cells = order.map((id, index) => {
        const metric = metrics[id]
        if (metric === undefined) return null
        const label = metric.title === undefined ? metric.label : `${metric.label} · ${metric.title}`
        return h(
          'span',
          {
            key: id,
            className: 'smx-item',
            draggable: true,
            tabIndex: 0,
            role: 'listitem',
            'data-priority': metric.priority,
            'data-selected': selected === id,
            'data-dragging': dragging === id,
            'aria-label': `${metric.label} ${metric.reading.number}${metric.reading.unit} — ${t('reorderHint')}`,
            title: label,
            onDragStart: (event) => {
              // Keep the composer's own file-drop handling out of this drag.
              event.stopPropagation()
              dragFrom.current = index
              setDragging(id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', id)
            },
            // Reorder live while dragging: the dragged metric takes the hovered
            // slot immediately, so the drop point is never in doubt.
            onDragOver: (event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'move'
              const from = dragFrom.current
              if (from === null || from === index) return
              dragFrom.current = index
              persist(moveSlot(order, from, index))
            },
            onDrop: (event) => {
              event.preventDefault()
              event.stopPropagation()
              dragFrom.current = null
              setDragging(null)
            },
            onDragEnd: () => {
              dragFrom.current = null
              setDragging(null)
            },
            onClick: () => setSelected((current) => (current === id ? null : id)),
            onKeyDown: (event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                const to = event.key === 'ArrowLeft' ? index - 1 : index + 1
                if (to < 0 || to >= order.length) return
                persist(moveSlot(order, index, to))
                setSelected(id)
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setSelected((current) => (current === id ? null : id))
              }
            },
          },
          h('span', { className: 'smx-key' }, metric.label),
          h('span', { className: 'smx-val', style: metric.color === undefined ? undefined : { color: metric.color } }, metric.reading.number),
          h('span', { className: 'smx-unit' }, metric.reading.unit),
        )
      })

      return h(
        'div',
        { className: 'smx-root', role: 'list', 'aria-label': t('reorderHint') },
        h('style', null, STYLES),
        cells,
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
