/**
 * dsh-system-vitals client half.
 *
 * Registers:
 *  - one `conversation.input.right` entry: the always-visible status line, in the
 *    composer's trailing cluster on the submit button's row;
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
    // Measuring before paint keeps the intermediate (too wide) state off screen.
    const useLayoutEffect = React.useLayoutEffect ?? React.useEffect

    const NS = 'dsh-system-vitals'
    const ENDPOINT = '/system-vitals/api/snapshot'
    const POLL_MS = 2000
    const ORDER_KEY = 'dsh-system-vitals:order'
    const VISIBLE_KEY = 'dsh-system-vitals:visible'
    /** Reported by the layout diagnostics so a stale bundle is obvious. */
    const VERSION = '1.3.13'

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
      nav: '负载条',
      settingsIntro: '选择在输入框工具行里显示哪些读数。取消勾选即隐藏。',
      showLabel: '显示的读数',
      orderLabel: '顺序',
      orderHint: '在工具行里拖动某个读数，或用左右方向键调整顺序；顺序与显隐都会保留。',
      resetOrder: '恢复默认顺序',
      showAll: '全部显示',
      resetTip: '以上偏好保存在浏览器本地（localStorage），刷新后仍然生效。',
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
      settingsIntro: 'Choose which readings appear in the composer tool row. Uncheck one to hide it.',
      showLabel: 'Readings',
      orderLabel: 'Order',
      orderHint: 'Drag a reading in the tool row, or move it with the arrow keys.',
      resetOrder: 'Reset order',
      showAll: 'Show all',
      resetTip: 'These preferences live in this browser (localStorage) and survive a reload.',
      empty: 'Every reading is hidden, so the tool row shows nothing.',
      switchOn: 'Shown',
      switchOff: 'Hidden',
    }

    const STYLES = `
/* One rigid cell for the composer tool row: 4ch label + 3ch number + 3ch unit. */
/* The composer control row is a flex-wrap row whose trailing cluster is
   flex: none, and the host measures that row (observeControlRow) to decide its
   own compact mode. A strip that cannot yield therefore forces the row to wrap,
   which moves the native controls onto a line of their own. Two rules keep the
   row intact instead:
     1. cap the strip against the width actually left over on that row, measured
        in JS from the sibling controls (a container-unit cap was silently
        dropped by the host page, so the strip kept its full width and forced
        the wrap), and applied from inside the ResizeObserver callback rather
        than through React state — a state update is committed after the frame
        has been painted, which left one frame per resize step showing the strip
        too wide and squashing the row's shrinkable native controls before the
        correction landed; and
     2. keep the strip on exactly ONE line, clipping at its right edge, so the
        row's height never changes. Wrapping the cells onto two lines grew the
        strip's height, and because the trailing cluster centres its items that
        shifted the native controls vertically on every resize.
   Clipping means the readings at the right edge lose their room first, so the
   leftmost cells — the beginning of the user's own order — always survive.
   The cap snaps to whole cells, so the cut always falls between two readings
   and no value is ever seen half-drawn; the strip used to end in a 12px
   gradient to hide a partial cell, which only faded the last visible reading.

   The cap is recomputed whenever that row resizes: it is the row's content width
   minus every control outside the strip's own branch, minus the gaps between
   them, minus a 12px safety margin. Measuring the real controls keeps the reserve
   correct when the model seat switches between its full label and the compact
   icon, which is exactly when a fixed reserve would be wrong. Below roughly
   400px of row width only one to two readings survive the cap; that is the
   intended trade-off — the leading readings win over wrapping. */
.smx-root{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-start;
  gap:10px;flex-wrap:nowrap;overflow:hidden;
  flex:0 1 auto;min-width:0;
  max-width:100%;
  color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;font-variant-numeric:tabular-nums}
.smx-item{display:inline-flex;align-items:baseline;gap:3px;flex:none;width:calc(10ch + 6px);
  white-space:nowrap;
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

    const tagOf = (element) => `${element.tagName.toLowerCase()}.${String(element.className || '').split(' ')[0]}`

    /** The nearest ancestor that declares itself an inline-size container. */
    function findContainer(element) {
      let node = element?.parentElement ?? null
      while (node !== null) {
        const type = typeof window.getComputedStyle === 'function'
          ? window.getComputedStyle(node).containerType
          : ''
        if (type && type !== 'normal') return node
        node = node.parentElement
      }
      return null
    }

    /**
     * Width the strip may occupy on the composer row.
     *
     * Measured from the row, not from the strip: subtract every sibling on the
     * row (the tool cluster) and everything in the strip's own ancestor branch
     * except the strip itself. Leaf-level measuring failed here — the model seat
     * reports 0 width from its own element while occupying ~200px — so the
     * branch residual (its real width minus ours) is what gets subtracted.
     *
     * The residual is capped at 150px: the host collapses the model seat to an
     * icon when the row runs out of room, so planning for its fully expanded
     * label (200px+) would starve the strip — but the collapsed seat plus the
     * submit button still occupy ~116px, and capping below that made the strip
     * underestimate the row and wrap.
     *
     * The budget is the row's CONTENT box, because that is the number the host
     * compares its own "does everything fit" sum against (`width - paddings`).
     * `clientWidth` still carries the row's horizontal padding, so being 16px
     * more generous than the host is enough to make it flip its compact mode or
     * wrap exactly at the boundary — subtract the padding as well.
     */
    function measureAvailable(element) {
      const container = findContainer(element)
      if (container === null) return null
      const branch = new Set()
      for (let node = element; node !== null && node !== container; node = node.parentElement) branch.add(node)

      const selfWidth = element.getBoundingClientRect().width
      let used = 0
      let count = 0
      const parts = []
      for (const child of container.children) {
        const width = child.getBoundingClientRect().width
        if (branch.has(child)) {
          // Our own branch: subtract everything but the strip itself.
          const residual = Math.max(0, width - selfWidth)
          const counted = Math.min(residual, 150)
          used += counted
          count += 1
          parts.push({ where: 'branch', tag: tagOf(child), w: Math.round(width), residual: Math.round(residual), counted: Math.round(counted) })
          continue
        }
        used += width
        count += 1
        parts.push({ where: 'row', tag: tagOf(child), w: Math.round(width), counted: Math.round(width) })
      }

      const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(container) : null
      const gap = style === null ? 0 : Number.parseFloat(style.columnGap) || 0
      const gaps = Math.max(0, count - 1) * gap
      // Real margin now, not a fudged one: the 12px this replaced was raised
      // while the budget still included the row's padding, so the effective
      // margin was 12 - 16 = -4px. With the content box as the basis, 8px of
      // genuine slack is enough to absorb sub-pixel rounding and still leaves
      // the whole-cell snap its room (12px cost the fifth reading at 1280px).
      const safety = 8
      const padX = style === null
        ? 0
        : (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
      const contentWidth = Math.max(0, container.clientWidth - padX)
      const available = contentWidth - used - gaps - safety
      return {
        available: Math.max(0, Math.floor(available)),
        row: contentWidth,
        used: Math.round(used),
        gaps: Math.round(gaps + safety),
        gap,
        padX: Math.round(padX),
        count,
        siblings: parts,
        tag: tagOf(container),
      }
    }

    /** Fire-and-forget diagnostic: which numbers produced the current cap. */
    let reportTimer = 0
    let pendingReport = null
    function report(payload) {
      pendingReport = { ...payload, version: VERSION }
      if (reportTimer !== 0) return
      const schedule = window.setTimeout ?? setTimeout
      reportTimer = schedule(() => {
        reportTimer = 0
        const body = JSON.stringify(pendingReport)
        try {
          void fetch(`${ENDPOINT.replace('/snapshot', '/measure')}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {})
        } catch {
          /* Diagnostics must never break the strip. */
        }
      }, 250)
    }

    function MetricsBar(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const { snapshot, failed } = useSnapshot()
      const { order, visible } = usePreferences()
      const [selected, setSelected] = useState(null)
      const [dragging, setDragging] = useState(null)
      const [cap, setCap] = useState(0)
      const rootRef = useRef(null)
      // Slot index being dragged, kept in a ref so drag handlers always read the
      // newest value without waiting for a re-render.
      const dragFrom = useRef(null)
      // Hysteresis: ignore sub-pixel churn and only re-apply a materially
      // different cap, so a resize never makes the strip and the row's compact
      // mode chase each other.
      const capRef = useRef(0)
      const rowRef = useRef(null)

      useLayoutEffect(() => {
        const mounted = rootRef.current
        if (mounted === null) return undefined
        let container = findContainer(mounted)
        let observer = null
        /**
         * Put the cap on the element right now, without waiting for React.
         *
         * This is the whole point of writing styles from inside the observer: a
         * `setState` here is committed in a scheduled task that runs AFTER the
         * frame being rendered has been painted, so the frame that follows a
         * window resize would still paint the strip at its previous (wider)
         * width. That one frame of overflow is what squashes the row's
         * shrinkable native controls — the `+`, the permission/mode selectors
         * and the model seat — and makes them snap back a frame later, which is
         * the flicker. Writing the style inside the callback keeps the
         * correction inside the same rendering update, so no painted frame ever
         * shows the strip wider than the row allows. The state update below
         * only keeps React's own view of the cap in sync for later renders.
         */
        const apply = (element, limit) => {
          const next = limit === null ? '' : `${limit}px`
          if (element.style.maxWidth !== next) element.style.maxWidth = next
        }
        const measure = () => {
          // Read the live node: hiding every reading unmounts the strip, and the
          // node that comes back is a new one.
          const element = rootRef.current
          if (element === null || typeof element.getBoundingClientRect !== 'function') return
          if (observer !== null) observer.observe(element)
          const detail = measureAvailable(element)
          if (detail === null) {
            // No container to measure against: fall back to the natural width
            // rather than staying at the zero-width pre-measure state.
            apply(element, null)
            capRef.current = null
            setCap(null)
            report({ stage: 'no-container' })
            return
          }
          // A partially visible reading looks broken, so drop the last cell when
          // only a small part of it would show — but keep it when most of the
          // cell is visible, otherwise a 2px shortfall would cost a whole reading.
          // The first child is the injected <style>, so look the cell up by class.
          const firstCell = typeof element.querySelector === 'function' ? element.querySelector('.smx-item') : null
          const cell = firstCell === null ? 0 : firstCell.getBoundingClientRect().width
          let limit = detail.available
          const selfGap = Number.parseFloat(
            typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element).columnGap : '',
          ) || 10
          if (cell > 0) {
            const unit = cell + selfGap
            const fit = Math.floor((detail.available + selfGap) / unit)
            const whole = fit > 0 ? fit * unit - selfGap : 0
            const remainder = detail.available - whole
            limit = fit > 0 && remainder < cell / 2 ? whole : Math.min(detail.available, Math.max(whole, 0))
            if (fit === 0) limit = 0
          }
          // Sub-pixel noise would otherwise serialize a style different from the
          // value React renders later and cause pointless writes.
          limit = Math.round(limit * 100) / 100
          // Same rendering update, before paint: this is not subject to the 4px
          // hysteresis below, because the hysteresis exists to keep React from
          // re-rendering on sub-pixel churn, not to leave the DOM wrong.
          apply(element, limit)
          const rowChanged = rowRef.current !== detail.row
          rowRef.current = detail.row
          if (rowChanged || capRef.current === null || Math.abs(limit - capRef.current) >= 4) {
            capRef.current = limit
            setCap(limit)
          }
          // Watch the row's own children as well: when the host flips the model
          // seat between its label and its icon it changes THEIR widths, and the
          // row's own width does not move at all, so a row-only observer would
          // not notice that the space available to the strip just changed.
          if (container !== null && observer !== null) {
            for (const child of container.children) observer.observe(child)
          }
          report({
            stage: 'measured',
            available: detail.available,
            limit: Math.round(limit),
            cell: Math.round(cell),
            row: detail.row,
            used: detail.used,
            gaps: detail.gaps,
            natural: Math.round(element.scrollWidth),
            rendered: Math.round(element.getBoundingClientRect().width),
            container: detail.tag,
            gap: detail.gap,
            padX: detail.padX,
            count: detail.count,
            siblings: detail.siblings,
          })
        }
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(measure)
          if (container !== null) observer.observe(container)
          observer.observe(mounted)
        }
        measure()
        return () => {
          if (observer !== null) observer.disconnect()
        }
      }, [])

      const now = snapshot && snapshot.now ? snapshot.now : null

      if (now === null) {
        return h(
          'div',
          { ref: rootRef, className: 'smx-root' },
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
        {
          ref: rootRef,
          className: 'smx-root',
          role: 'list',
          'aria-label': t('reorderHint'),
          style: cap === null ? undefined : { maxWidth: `${cap}px` },
        },
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
        // `conversation.input.right` lives inside the composer's `.trailing`
        // cluster, the same flex group as the submit button. Registering there
        // keeps the strip on the submit button's row at every width: the host
        // row is `flex-wrap: wrap`, so a strip inside `.tools` stayed on line one
        // while `.trailing` wrapped to line two, which looked like the strip
        // jumping upward. Sharing `.trailing` means the two wrap together.
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.right',
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
