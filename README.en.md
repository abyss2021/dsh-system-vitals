# dsh-system-vitals

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-6c757d)](#compatibility)

**System vitals for DeepSeek Harness.** A single always-visible status line inside the
composer tool row — right next to the permission control — showing **CPU load, CPU
temperature, memory, disk and live upload/download throughput** on Linux, macOS and
Windows. Sampled every second, zero runtime dependencies.

```
+  Auto review ⌄   CPU  2.8%  TEMP  41°C  MEM  14%  DISK  13%  UP  128K/s  DOWN  1.60M/s
```

No task manager, no window switching, no scrolling back through the chat: the numbers sit
exactly where you type.

## Highlights

- **One compact line**: CPU · temperature · memory · disk · upload · download, always visible.
- **Zero dependencies, no shell commands**: reads Linux kernel counters (`/proc`, `/sys`)
  directly — no `top`, `ps` or `nvidia-smi`, no native module.
- **Rigid cells, no jitter**: each reading is a fixed cell (`label 4ch + number 3.5ch + unit 2.5ch`),
  so `9%` → `10%` never shifts the strip.
- **Three significant digits at most**: the unit is rescaled (`B/s → K/s → M/s → G/s`)
  instead of widening a cell.
- **Threshold colors**: CPU/memory warn at 75%, error at 90%; disk at 85% / 95%; temperature at 80°C / 92°C.
- **Narrow-window aware**: secondary readings drop instead of pushing the model selector away.
- **Theme and locale aware**: only `--dsw-alias-*` design tokens, Chinese and English built in.

## Install

Requires DSH around `0.2.1-rc.2`, Node ≥ 20, and a profile with the Web UI (`dsh web`).

```bash
dsh plugin --profile web add github:abyss2021/dsh-system-vitals
```

From a local checkout: `dsh plugin --profile web add /path/to/dsh-system-vitals`.

> Once an npm release exists, `dsh plugin --profile web add dsh-system-vitals` also works.
> Keep the two commands out of the same code block: the plugin-store install detector
> treats two executable candidates as `ambiguous` and then shows none.  

Refresh the page afterwards. Uninstall:

```bash
dsh plugin --profile web remove dsh-system-vitals
```

> The package is a **bundle plus a Client half**: the Host side samples and serves one
> same-origin HTTP route, the Client side registers a React component into
> `conversation.input.left`. There is no build step — `client.js` is a browser module the
> Harness module loader can execute directly.

## What it shows

| Reading | Linux | macOS | Windows |
|---|---|---|---|
| CPU load (total, per core) | `/proc/stat` deltas | Node `os.cpus()` time deltas | `Win32_PerfFormattedData_PerfOS_Processor` |
| CPU temperature | `/sys/class/hwmon` (`coretemp`/`k10temp`/`zenpower`/`cpu_thermal`…), falling back to `/sys/class/thermal` | `powermetrics --samplers smc` (usually unreadable without root; falls back to `osx-cpu-temp`/`istats`) | `MSAcpi_ThermalZoneTemperature` (not exposed on most consumer boards, so often `—`) |
| Memory / swap | `/proc/meminfo` | Node `os.totalmem/freemem` plus `sysctl vm.swapusage` | `Win32_PerfFormattedData_PerfOS_Memory` (swap reported as commit) |
| Disk usage | `fs.statfs('/')` | `fs.statfs('/')` | `Win32_LogicalDisk` (system drive) |
| Upload / download | `/proc/net/dev` deltas | `netstat -ib` deltas | `Bytes*Persec` from `Win32_PerfFormattedData_Tcpip_NetworkInterface` |
| (Host-only extras) load average, task count, uptime | `/proc/loadavg`, `/proc`, `/proc/uptime` | `os.loadavg()` / `os.uptime()` | `NumberOfProcesses` / `LastBootUpTime` |

The Host samples once a second; the Client polls `GET /system-vitals/api/snapshot` every two seconds.
Anything a platform cannot read is returned as `null` and rendered as `—`; no value is invented.

### Per-platform notes

- **Linux**: plain file reads — no subprocess, no dependency.
- **macOS**: short `sysctl`/`netstat` calls plus Node APIs; the temperature probe is expensive, so it refreshes every fifth sample and is cached between them.
- **Windows**: one long-lived PowerShell child streams one JSON line per second (the performance counters already report percentages and per-second byte rates, so no deltas are needed). If the child exits it restarts after a five-second backoff and the last sample is reused meanwhile.
- Any other platform falls back to a minimal Node-only reading (memory, load, uptime); CPU load and throughput render `—`.

## Reordering

Every reading is an independently selectable cell:

- **Drag** a reading to another slot; slots swap live while dragging and the order is
  committed on drop.
- **Keyboard**: focus a cell with Tab and move it with `←` / `→` (`Enter` / `Space` selects).
- **Persistence**: the order is stored in `localStorage` under `dsh-system-vitals:order` and
  survives reloads. Ids this build no longer knows are dropped, and missing readings are
  appended back.

Cells are equal width and dragging leaves **no placeholder**, so the strip's width and
absolute position are identical in every order — only which reading occupies which slot changes.

## Choosing which readings appear

**Settings → System Vitals** lists every reading with a switch:

- Uncheck a reading to hide it; a live preview shows the resulting strip.
- `Show all` restores everything; the Order group offers `Reset order`.

Preferences live in `localStorage` (`dsh-system-vitals:visible` / `:order`) and survive reloads.

> **Why width-based hiding is gone**: earlier versions used container queries to drop
> secondary readings on a narrow card, which made a custom order look "reset" after a
> resize. Visibility is now your explicit choice, so **window width never changes what is
> shown or in which order**. On a narrow window, hide the readings you do not care about.

## Configuration

Override the row's `config` in the profile patch layer:

```yaml
- insert:
    - id: system-vitals
      name: dsh-system-vitals
      config:
        intervalMs: 1000   # Host sampling interval, 250–10000 ms; network rates derive from it
```

## Compatibility

- **Platform**: full support on Linux; macOS and Windows cover CPU, memory, disk and throughput, with temperature depending on the model and permissions.
- **DSH**: developed and verified on `0.2.1-rc.2`, using only stable
  `webServer.register`, `ctx.slots.register/inject` and `ctx.locale.register` APIs.
- **Node**: ≥ 20 (`fs.statfs`).

## Security

`GET /system-vitals/api/snapshot` is an **unauthenticated, local-only** route served by the
DSH web listener (bound to `127.0.0.1` by default). Any local process can read `/proc`
anyway, so this adds no real exposure — but do not expose the DSH Web UI publicly
(`--host 0.0.0.0`) with this plugin installed.

## Layout

```
dsh-system-vitals/
├── package.json         # dsh.bundle / dsh.client / exports
├── cordis.patch.yml     # inserts the plugin row
├── index.js             # Host half: sampling and HTTP route
├── client.js            # Client half: the status line
├── locale/{zh,en}.json  # display metadata for the plugin inventory
├── icon.svg             # plugin icon
└── README.md / README.en.md / LICENSE
```

## Development and publishing

```bash
node --check index.js
node --check client.js
for file in platform/*.js; do node --check "$file"; done
npm pack --dry-run
npm publish
```

Bump the version (`npm version patch|minor|major`) and update `CHANGELOG.md` before publishing.

Reinstall after changes:

```bash
dsh plugin --profile web remove dsh-system-vitals
dsh plugin --profile web add /path/to/dsh-system-vitals
```

## License

[MIT](LICENSE)
