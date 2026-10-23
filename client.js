/**
 * dsh-system-vitals client half.
 *
 * Registers:
 *  - one `conversation.input.left` entry: the always-visible status line, inside
 *    the composer card's tool row directly right of the permission control;
 *  - one `settings.section` entry: a page that chooses which readings are shown.
 *
 * Layout contract: every reading is the same rigid cell (label · number ·
 * unit), so gaps are identical and the strip never reflows when a digit
 * appears. Numbers hold at most three significant digits; the unit is rescaled
 * (B/s → K/s → M/s) instead of widening the cell.
 *
 * Stability contract: the strip's contents never depend on the viewport or card
 * width. Earlier versions hid readings with container queries, which made a
 * user's custom order appear to "reset" on resize — visibility is now an
 * explicit user preference, so resizing cannot change the order.
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
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'dsh-system-vitals'
    const ENDPOINT = '/system-vitals/api/snapshot'
    const POLL_MS = 2000
    const ORDER_KEY = 'dsh-system-vitals:order'
    const VISIBLE_KEY = 'dsh-system-vitals:visible'

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
      nav: '系统体征',
      settingsTitle: '系统体征',
      settingsIntro: '选择在输入框工具行里显示哪些读数，并查看当前顺序。取消勾选即隐藏。',
      showLabel: '显示的读数',
      orderLabel: '顺序',
      orderHint: '在工具行里拖动某个读数，或用左右方向键调整顺序。',
      resetOrder: '恢复默认顺序',
      showAll: '全部显示',
      resetTip: '以上偏好保存在浏览器本地（localStorage），刷新后仍然生效。',
      preview: '预览',
      empty: '全部读数已隐藏，工具行不会显示任何内容。',
      switchOn: '显示',
      switchOff: '隐藏',
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
      nav: 'System Vitals',
      settingsTitle: 'System Vitals',
      settingsIntro: 'Choose which readings appear in the composer tool row. Uncheck one to hide it.',
      showLabel: 'Readings',
      orderLabel: 'Order',
      orderHint: 'Drag a reading in the tool row, or move it with the arrow keys.',
      resetOrder: 'Reset order',
      showAll: 'Show all',
      resetTip: 'These preferences live in this browser (localStorage) and survive a reload.',
      preview: 'Preview',
      empty: 'Every reading is hidden, so the tool row shows nothing.',
      switchOn: 'Shown',
      switchOff: 'Hidden',
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

/* Settings page: rows follow the settings shell's own rhythm. */
.sv-root{display:flex;flex-direction:column;width:100%;gap:18px;padding:8px 2px 32px;
  color:var(--dsw-alias-label-primary)}
.sv-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.sv-groupTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}
.sv-groupHint{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
.sv-list{display:flex;flex-direction:column;margin-top:8px}
.sv-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 0;
  border-bottom:.5px solid var(--dsw-alias-border-l2)}
.sv-row:last-child{border-bottom:none}
.sv-rowMain{display:flex;align-items:baseline;gap:10px;min-width:0}
.sv-index{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;min-width:2ch}
.sv-name{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.sv-reading{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px}
.sv-switch{flex:none;position:relative;width:40px;height:22px;padding:0;border:none;border-radius:999px;
  cursor:pointer;background:var(--dsw-alias-interactive-bg-hover);
  transition:background-color .15s ease}
.sv-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.sv-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sv-knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-bg-layer-1);transition:transform .15s ease}
.sv-switch[aria-checked="true"] .sv-knob{transform:translateX(18px)}
.sv-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.sv-button{border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;background:none;cursor:pointer;
  color:var(--dsw-alias-label-secondary);padding:5px 10px;font-size:12px;line-height:18px}
.sv-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sv-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sv-preview{margin-top:8px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;
  background:var(--dsw-alias-bg-layer-1)}
.sv-previewRow{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.sv-empty{color:var(--dsw-alias-label-secondary);font-size:13px}
.sv-tip{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
`

    /* ---------------------------------------------------------------- store */

    /**
     * Shared, reactive preferences. The strip and the settings page live in
     * different slots but the same module instance, so one module-level store
     * keeps them in sync — including across two mounted strips.
     */
    function readStored(key, fallback, reconcile) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        return reconcile(parsed)
      } catch {
        return fallback
      }
    }

    const reconcileOrder = (parsed) => {
      if (!Array.isArray(parsed)) return DEFAULT_ORDER
      const known = parsed.filter((id) => DEFAULT_ORDER.includes(id))
      const missing = DEFAULT_ORDER.filter((id) => !known.includes(id))
      return [...new Set(known), ...missing]
    }

    const reconcileVisible = (parsed) => {
      if (!Array.isArray(parsed)) return [...DEFAULT_ORDER]
      const known = parsed.filter((id) => DEFAULT_ORDER.includes(id))
      return known.length > 0 ? [...new Set(known)] : []
    }

    const store = {
      order: readStored(ORDER_KEY, DEFAULT_ORDER, reconcileOrder),
      visible: readStored(VISIBLE_KEY, DEFAULT_ORDER, reconcileVisible),
      listeners: new Set(),
      snapshot: null,
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      getSnapshot() {
        if (this.snapshot === null) this.snapshot = { order: this.order, visible: this.visible }
        return this.snapshot
      },
      write(next) {
        if (next.order !== undefined) this.order = next.order
        if (next.visible !== undefined) this.visible = next.visible
        this.snapshot = { order: this.order, visible: this.visible }
        try {
          window.localStorage.setItem(ORDER_KEY, JSON.stringify(this.order))
          window.localStorage.setItem(VISIBLE_KEY, JSON.stringify(this.visible))
        } catch {
          /* A blocked localStorage keeps the preference for this session only. */
        }
        for (const listener of this.listeners) listener()
      },
      setOrder(order) {
        this.write({ order })
      },
      toggle(id) {
        const visible = this.visible.includes(id)
          ? this.visible.filter((entry) => entry !== id)
          : [...this.visible, id]
        // Keep `visible` in canonical metric order so a toggle never reshuffles
        // the strip; display order always comes from `order`.
        this.write({ visible: DEFAULT_ORDER.filter((entry) => visible.includes(entry)) })
      },
      resetOrder() {
        this.write({ order: [...DEFAULT_ORDER] })
      },
      showAll() {
        this.write({ visible: [...DEFAULT_ORDER] })
      },
    }

    const usePreferences = () => useSyncExternalStore(
      (listener) => store.subscribe(listener),
      () => store.getSnapshot(),
    )

    /* --------------------------------------------------------------- format */

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

    /**
     * Move the reading at visible index `from` to visible index `to`, operating on
     * the FULL order so hidden readings keep their slots instead of being dropped.
     */
    function moveWithinVisible(order, visible, from, to) {
      const shown = order.filter((id) => visible.includes(id))
      if (from === to || from < 0 || to < 0 || from >= shown.length || to >= shown.length) return order
      const movingId = shown[from]
      const anchorId = shown[to]
      const next = order.filter((id) => id !== movingId)
      const anchorIndex = next.indexOf(anchorId)
      if (anchorIndex < 0) return order
      // Insert before the anchor when moving left, after it when moving right.
      next.splice(from < to ? anchorIndex + 1 : anchorIndex, 0, movingId)
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

    /** All readings for one snapshot, keyed by metric id. */
    function buildMetrics(now, t) {
      const cpuPercent = now && now.cpu ? now.cpu.percent : null
      const memory = now ? now.mem ?? null : null
      const disk = now ? now.disk ?? null : null
      const net = now ? now.net ?? null : null
      return {
        cpu: {
          label: t('cpu'),
          reading: splitPercent(cpuPercent),
          color: tone(cpuPercent, 75, 90),
          title: `CPU ${Number.isFinite(cpuPercent) ? Math.round(cpuPercent * 10) / 10 : '—'}%`,
        },
        temperature: {
          label: t('temperature'),
          reading: splitTemperature(now ? now.temperature : Number.NaN),
          color: tone(now ? now.temperature : Number.NaN, 80, 92),
          title: now && Number.isFinite(now.temperature) ? `${now.temperature}°C` : undefined,
        },
        mem: {
          label: t('mem'),
          reading: splitPercent(memory ? memory.percent : Number.NaN),
          color: tone(memory ? memory.percent : Number.NaN, 80, 92),
          title: memory ? `${formatGiB(memory.used)}G / ${formatGiB(memory.total)}G` : undefined,
        },
        disk: {
          label: t('disk'),
          reading: splitPercent(disk ? disk.percent : Number.NaN),
          color: tone(disk ? disk.percent : Number.NaN, 85, 95),
          title: disk ? `${formatGiB(disk.used)}G / ${formatGiB(disk.total)}G` : undefined,
        },
        upload: {
          label: t('upload'),
          reading: splitRate(net ? net.tx : Number.NaN),
          title: net ? `${Math.round(net.tx / 1024)} KB/s` : undefined,
        },
        download: {
          label: t('download'),
          reading: splitRate(net ? net.rx : Number.NaN),
          title: net ? `${Math.round(net.rx / 1024)} KB/s` : undefined,
        },
      }
    }

    /* ---------------------------------------------------------------- strip */

    function MetricsBar(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const { snapshot, failed } = useSnapshot()
      const { order, visible } = usePreferences()
      const [selected, setSelected] = useState(null)
      const [dragging, setDragging] = useState(null)
      // Slot index being dragged, kept in a ref so drag handlers always read the
      // newest value without waiting for a re-render.
      const dragFrom = useRef(null)

      const now = snapshot && snapshot.now ? snapshot.now : null

      if (now === null) {
        return h(
          'div',
          { className: 'smx-root' },
          h('style', null, STYLES),
          h('span', { className: 'smx-wait' }, failed ? t('unavailable') : t('waiting')),
        )
      }

      const metrics = buildMetrics(now, t)
      const shown = order.filter((id) => visible.includes(id))
      if (shown.length === 0) return null

      const cells = shown.map((id, index) => {
        const metric = metrics[id]
        if (metric === undefined) return null
        const caption = metric.title === undefined ? metric.label : `${metric.label} · ${metric.title}`
        return h(
          'span',
          {
            key: id,
            className: 'smx-item',
            draggable: true,
            tabIndex: 0,
            role: 'listitem',
            'data-selected': selected === id,
            'data-dragging': dragging === id,
            'aria-label': `${metric.label} ${metric.reading.number}${metric.reading.unit} — ${t('reorderHint')}`,
            title: caption,
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
              store.setOrder(moveWithinVisible(order, visible, from, index))
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
                if (to < 0 || to >= shown.length) return
                store.setOrder(moveWithinVisible(order, visible, index, to))
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

    /* ------------------------------------------------------------- settings */

    function Switch({ checked, label, onToggle }) {
      return h(
        'button',
        {
          type: 'button',
          className: 'sv-switch',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          title: label,
          onClick: onToggle,
        },
        h('span', { className: 'sv-knob' }),
      )
    }

    function VitalsSettings(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const { snapshot } = useSnapshot()
      const { order, visible } = usePreferences()
      const now = snapshot && snapshot.now ? snapshot.now : null
      const metrics = buildMetrics(now, t)

      const rows = order.map((id, index) => {
        const metric = metrics[id]
        if (metric === undefined) return null
        const checked = visible.includes(id)
        const reading = now === null ? '—' : `${metric.reading.number}${metric.reading.unit}`
        return h(
          'div',
          { className: 'sv-row', key: id },
          h(
            'span',
            { className: 'sv-rowMain' },
            h('span', { className: 'sv-index' }, `${index + 1}`),
            h('span', { className: 'sv-name' }, metric.label),
            h('span', { className: 'sv-reading' }, reading),
          ),
          h(Switch, {
            checked,
            label: `${metric.label} — ${checked ? t('switchOn') : t('switchOff')}`,
            onToggle: () => store.toggle(id),
          }),
        )
      })

      const preview = order.filter((id) => visible.includes(id)).map((id) => {
        const metric = metrics[id]
        return h(
          'span',
          { className: 'smx-item', key: id, title: metric.title ?? metric.label },
          h('span', { className: 'smx-key' }, metric.label),
          h('span', { className: 'smx-val', style: metric.color === undefined ? undefined : { color: metric.color } }, metric.reading.number),
          h('span', { className: 'smx-unit' }, metric.reading.unit),
        )
      })

      return h(
        'div',
        { className: 'sv-root' },
        h('style', null, STYLES),
        h('div', { className: 'sv-intro' }, t('settingsIntro')),
        h(
          'div',
          null,
          h('div', { className: 'sv-groupTitle' }, t('showLabel')),
          h(
            'div',
            { className: 'sv-list' },
            rows,
          ),
          h(
            'div',
            { className: 'sv-actions' },
            h('button', { className: 'sv-button', type: 'button', onClick: () => store.showAll() }, t('showAll')),
          ),
        ),
        h(
          'div',
          null,
          h('div', { className: 'sv-groupTitle' }, t('orderLabel')),
          h('div', { className: 'sv-groupHint' }, t('orderHint')),
          h(
            'div',
            { className: 'sv-actions' },
            h('button', { className: 'sv-button', type: 'button', onClick: () => store.resetOrder() }, t('resetOrder')),
          ),
          h(
            'div',
            { className: 'sv-preview' },
            preview.length > 0
              ? h('div', { className: 'sv-previewRow' }, preview)
              : h('span', { className: 'sv-empty' }, t('empty')),
          ),
        ),
        h('div', { className: 'sv-tip' }, t('resetTip')),
      )
    }

    /* ------------------------------------------------------------- register */

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

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'system-vitals',
              order: 46,
              label: () => ctx.locale.bind(NS)('nav'),
              locale: NS,
            },
            VitalsSettings,
          ),
        )
      },
    }
  },
})
