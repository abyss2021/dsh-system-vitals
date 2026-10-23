# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
