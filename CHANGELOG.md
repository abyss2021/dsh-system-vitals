# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
