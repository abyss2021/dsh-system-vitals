# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.11] - 2026-10-23

Verified against the live Web UI in headless Chromium, sweeping the viewport
1300 -> 470 px in 10 px steps: the 1.3.10 build paints 4 over-wide frames (the
composer row wraps to a second line and snaps back) and ends the sweep
permanently wrapped; this build paints none and keeps a single line.

### Changed

- Chinese display name is now 「负载条」 (was 「系统体征」): the settings nav entry
  and the plugin-market title. The package name stays `dsh-system-vitals`, so
  installed copies and install commands are unaffected.

### Fixed

- The left-hand controls no longer jump and snap back while the window width
  changes. 1.3.10 measured the cap in a layout effect, which only covers
  React's own commits: the resize path went through `setState` from a
  `ResizeObserver`, and React commits a state update in a task that runs *after*
  the current frame is painted. Every resize step therefore painted one frame
  with the strip still at its previous, wider cap; that overflow squashed the
  row's shrinkable native controls (`+`, the permission/mode selectors, the
  model seat) for exactly that frame, and the next frame restored them — the
  flicker. The cap is now written straight to the element's `max-width` inside
  the observer callback, so the correction is part of the same rendering update
  and no painted frame can show the strip wider than the row allows. The
  observer also watches the row's children now, because the host flips the model
  seat's compact mode by changing *their* widths without moving the row's width.
- The cap is measured against the row's content box, the same box the host
  compares its own "does everything fit" sum against. `clientWidth` carries the
  row's 16px horizontal padding, so the strip used to plan with 4px less margin
  than intended and could make the host wrap or compact right at the boundary.

## [1.3.10] - 2026-10-23

### Fixed

- No more transient jump of the composer's left controls while resizing. Three
  causes are addressed: the strip started at its natural width and only shrank
  after a post-paint effect ran (the overflow in that frame pushed the `+` and
  permission controls onto their own line); the cap is now measured in a layout
  effect and the strip starts at zero width, so no paint ever overflows. A 4px
  hysteresis stops sub-pixel churn, and the safety margin grew from 4px to 12px
  so the host's compact-mode toggle no longer flips on rounding.

## [1.3.9] - 2026-10-23

### Fixed

- The whole-cell snap never ran: it read `element.children[0]` as the first
  reading, but the root's first child is the injected `<style>`. It now looks the
  cell up by class, and only drops the last reading when less than half of it
  would be visible — so a 2px shortfall no longer costs a whole reading.

## [1.3.8] - 2026-10-23

### Fixed

- Raised the branch-residual cap from 90px to 150px. The collapsed model seat
  plus the submit button really occupy ~116px, so capping at 90 made the cap
  underestimate the row by 26px and the row wrapped again in narrower windows.
- The diagnostics report now carries the real bundle version instead of a stale
  hard-coded string, so a browser running an old module is obvious at a glance.

## [1.3.7] - 2026-10-23

### Fixed

- The width cap is finally measured against the right numbers. The diagnostics
  showed `available 486 > natural 442` — the cap never bound — because the model
  seat reports 0 width from its own element while occupying ~200px. The cap now
  subtracts the **branch residual** (the strip's own ancestor row width minus the
  strip) instead of summing leaf children, capped at 90px so the host still
  collapses the model seat when the row is tight.

## [1.3.6] - 2026-10-23

### Changed

- The diagnostics report now lists every sibling the cap subtracts, with its real
  width and the width actually counted. The first report showed the cap was never
  binding (`available 486 > natural 442`), so the remaining wrap comes from the
  model seat and gaps rather than from the strip's own width.

## [1.3.5] - 2026-10-23

### Added

- A diagnostics route: the Client posts what it measured for the composer row
  (`GET /system-vitals/api/measure` returns the last report). It exists because
  the width cap could not be reproduced from the Host side, and guessing at the
  layout was costing more than instrumenting it. Requires no configuration and
  never affects rendering.

## [1.3.4] - 2026-10-23

### Fixed

- The width cap now actually applies. The container-unit version
  (`calc(100cqw - 260px)`) was dropped by the host page, so the strip kept its
  full width and the composer row still wrapped. The cap is now measured in JS:
  the row's content width minus every control outside the strip's own ancestor
  branch, the gaps, and a 4px safety margin, recomputed on resize.
- The model seat's contribution is planned at its compact width (24px), because
  the host compacts it when the row runs out of space. Planning for its expanded
  label starved the strip and then stopped the host from ever compacting.

## [1.3.3] - 2026-10-23

### Fixed

- The strip stays on exactly one line, so resizing no longer moves the composer
  controls vertically. Previously its cells wrapped onto a second line; the extra
  line height grew the strip, and the centred trailing cluster shifted the
  native controls on every resize.
- A narrow row now keeps the **leading** readings and clips the tail, instead of
  showing everything over two lines. A 12px gradient masks the cut edge so no
  value is seen half-drawn.
- Raised the width reserve to 260px, measured from the host controls (`+` 28 +
  permission ~118 + compact model seat 24 + submit 34 + three 12px gaps). The
  row holds a single line from a 320px row upward; the strip yields first.

## [1.3.2] - 2026-10-23

### Fixed

- The strip no longer pushes the composer's native controls onto a second line.
  The host control row is `flex-wrap: wrap` and measures itself
  (`observeControlRow`) to pick its compact mode, counting the strip's width; the
  trailing cluster is `flex: none`, so an uncapped strip forced a wrap that
  moved the permission and submit controls. The strip is now capped against the
  row's own width (`100cqw` minus a 250px reserve for the host controls) and its
  cells wrap inside that cap, so it always yields instead of displacing them.

## [1.3.1] - 2026-10-23

### Fixed

- The strip no longer appears to jump upward in a narrow window. It now registers
  in `conversation.input.right`, inside the composer's `.trailing` flex cluster
  together with the submit button. The host row is `flex-wrap: wrap` with
  `.tools` and `.trailing` as siblings, so a strip inside `.tools` stayed on the
  first line while the submit button wrapped to the second — which read as the
  strip moving up. Sharing `.trailing` makes both wrap together.

### Changed

- Reading names are unchanged from 1.0.0 (CPU / 温度 / 内存 / 磁盘 / 上传 / 下载).
- Dropped two locale keys (`settingsTitle`, `preview`) that no code path read.

## [1.3.0] - 2026-10-23

### Fixed

- Resizing the window no longer disturbs a custom order. The container queries
  that hid readings on a narrow card are gone: hiding is now an explicit
  preference, so the visible set and its order can never be recomputed by a
  viewport change.

### Added

- A **System Vitals** page in Settings (`settings.section`) listing every
  reading with a switch to show or hide it, a live preview of the resulting
  strip, `Show all`, and `Reset order`.
- Reordering now operates on the full order, so moving a reading while others
  are hidden keeps every hidden reading in its slot instead of dropping it.
- Preferences are shared through one reactive store, so the settings page and
  the strip stay in sync; `visible` is kept in canonical order so toggling never
  reshuffles the strip.

### Changed

- The strip renders nothing when every reading is hidden.

## [1.2.0] - 2026-10-23

### Added

- npm publishing metadata (`author`, `homepage`, `repository`, `bugs`,
  `publishConfig`) plus a `Publish` GitHub Actions workflow that checks the
  release tag against `package.json` and publishes with provenance.

- Reorder the readings: each cell is selectable, draggable into another slot, and
  movable with the arrow keys while focused. Slots swap live during a drag and
  the order is committed on drop; drag events do not reach the composer's own
  file-drop handling.
- The order persists in `localStorage` (`dsh-system-vitals:order`), reconciled
  against the metrics the build knows so a stale id is dropped and a missing
  reading is appended back.
- Cells are equal width and dragging leaves no placeholder, so the strip's width
  and absolute position are unchanged in every order.

## [1.1.0] - 2026-10-23

### Added

- macOS support: CPU and per-core load from Node `os.cpus()` deltas, memory from
  `os.totalmem/freemem`, swap from `sysctl vm.swapusage`, throughput from
  `netstat -ib`, disk from `fs.statfs`. CPU temperature uses `powermetrics`
  (SMC) when readable without root, falling back to `osx-cpu-temp`/`istats`,
  refreshed every fifth sample and cached in between.
- Windows support: one long-lived PowerShell child streams a JSON sample per
  second from the `Win32_PerfFormattedData_*` classes, which already report
  percentages and per-second byte rates. The child restarts with a five-second
  backoff on exit, and static host facts are captured once per child.
- A minimal Node-only fallback source for any other platform.
- Platform sources live under `platform/` (`linux.js`, `darwin.js`, `win32.js`,
  `shared.js`); the Host entry selects one by `process.platform` and the
  snapshot route now reports the platform.
- `supportedPlatforms` export listing the platforms with a dedicated source.

### Fixed

- The upload/download unit cell clipped its trailing `s` (`K/s` rendered as
  `K/`). The value cell is now 3ch and the unit cell 3ch, keeping the strip
  width unchanged while giving the unit room for three characters.
- Rate formatting stepped up units at 1024, so `1023 B/s` printed four
  characters and could overflow its cell; scaling now steps at 1000 and the
  scaled value is capped at 999.

### Changed

- READMEs document the per-platform reading sources and their limits; the
  compatibility and badge sections now advertise Linux, macOS and Windows.

## [1.0.0] - 2026-10-22

First public release.

### Added

- Always-visible system vitals in the composer tool row (`conversation.input.left`),
  rendered immediately right of the permission control.
- Readings: CPU load, CPU temperature, memory, root disk usage, live upload and
  download throughput.
- Host sampler built on Linux kernel counters (`/proc/stat`, `/proc/meminfo`,
  `/proc/net/dev`, `/proc/loadavg`, `/proc/uptime`, `/sys/class/hwmon`,
  `/sys/class/thermal`) with a same-origin HTTP snapshot route.
- Rigid fixed-width cells so digits never reflow the strip; three significant
  digits with automatic unit rescaling (`B/s → K/s → M/s → G/s`).
- Threshold colors for CPU, memory, disk and temperature.
- Narrow-window degradation through the host row's inline-size container query.
- Chinese and English locale dictionaries, plugin icon and display metadata.

### Security

- The snapshot route is unauthenticated and local-only; documented in the README.

## [0.3.0] - 2026-10-22

- Renamed the project from `dsh-system-metrics` to `dsh-system-vitals` to reflect
  the full set of readings (temperature and network throughput included).

## [0.2.x] - 2026-10-22

- Moved the strip from a standalone line under the composer into the composer card's
  tool row, then restored full-width labels after a compact-label experiment.

## [0.1.x] - 2026-10-22

- Initial implementation: a standalone status line under the composer with CPU,
  memory, load and disk readings.
