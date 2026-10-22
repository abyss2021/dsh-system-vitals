# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
