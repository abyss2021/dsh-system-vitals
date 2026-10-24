# dsh-system-vitals

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-6c757d)](#compatibility)

**A live status line for DeepSeek Harness.** One row inside the composer's tool cluster showing
**CPU load · CPU temperature · memory · disk · upload/download throughput**, on Linux, macOS and
Windows. Sampled every second, zero runtime dependencies.

![The status line inside the composer tool row](docs/preview.png)

No task manager, no window switching, no scrolling back through the chat: the numbers sit
exactly where you type.

## Highlights

- **One compact line** — CPU · temperature · memory · disk · upload · download, next to the submit button.
- **Zero dependencies** — Linux reads kernel counters (`/proc`, `/sys`) directly; macOS uses the
  built-in `sysctl`/`netstat`; Windows reads performance counters through one long-lived PowerShell
  child. No native module, no administrator rights.
- **Rigid cells, no jitter** — each reading is a fixed cell (`label 4ch + number 3ch + unit 3ch`),
  so `9%` → `10%` never shifts the strip.
- **Three significant digits at most** — the unit is rescaled (`B/s → K/s → M/s → G/s`) instead of
  widening a cell.
- **Threshold colors** — CPU/memory warn at 75%, error at 90%; disk at 85% / 95%; temperature at 80°C / 92°C.
- **Whole-cell clipping when space runs short** — the leading readings survive, and the cut always
  falls between two cells, so no half-drawn value is ever shown.
- **Theme and locale aware** — only `--dsw-alias-*` design tokens, Chinese and English built in.

## Install

Requires DSH around `0.2.1-rc.2`, Node ≥ 20, and a profile with the Web UI (`dsh web`).

```bash
dsh plugin --profile web add github:abyss2021/dsh-system-vitals
```

Refresh the page afterwards. Uninstall:

```bash
dsh plugin --profile web remove dsh-system-vitals
```

- Release notes live in [GitHub Releases](https://github.com/abyss2021/dsh-system-vitals/releases).
- From a local checkout: `dsh plugin --profile web add /path/to/dsh-system-vitals`.
- Once an npm release exists, `dsh plugin --profile web add dsh-system-vitals` also works. **Keep the
  two commands out of the same code block**: the plugin-store install detector treats two executable
  candidates as `ambiguous` and then shows none.

> The package is a **bundle plus a Client half**: the Host side samples and serves one same-origin
> HTTP route, the Client side registers a React component into `conversation.input.right` (the
> composer card's `.trailing` cluster, on the submit button's row) and one into `settings.section`.
> There is no build step — `client.js` is a browser module the Harness module loader executes directly.

## What it shows

| Reading | Linux | macOS | Windows |
|---|---|---|---|
| CPU load (total, per core) | `/proc/stat` deltas | Node `os.cpus()` time deltas | `Win32_PerfFormattedData_PerfOS_Processor` |
| CPU temperature | `/sys/class/hwmon` (`coretemp`/`k10temp`/`zenpower`/`cpu_thermal`…), falling back to `/sys/class/thermal` | `powermetrics --samplers smc` (usually unreadable without root; falls back to `osx-cpu-temp`/`istats`) | `MSAcpi_ThermalZoneTemperature` (not exposed on most consumer boards, so often `—`) |
| Memory / swap | `/proc/meminfo` | Node `os.totalmem/freemem` plus `sysctl vm.swapusage` | total from `Win32_OperatingSystem.TotalVisibleMemorySize`, available from `PerfOS_Memory.AvailableKBytes` (swap from `CommitLimit` / `CommittedBytes`) |
| Disk usage | `fs.statfs('/')` | `fs.statfs('/')` | `Win32_LogicalDisk` (system drive) |
| Upload / download | `/proc/net/dev` deltas | `netstat -ib` deltas | `Bytes*Persec` from `Win32_PerfFormattedData_Tcpip_NetworkInterface` |
| (Host-only extras) load average, task count, uptime | `/proc/loadavg`, `/proc`, `/proc/uptime` | `os.loadavg()` / `os.uptime()` | `NumberOfProcesses` / `LastBootUpTime` |

The Host samples once a second; the Client polls `GET /system-vitals/api/snapshot` every two seconds.
Anything a platform cannot read is returned as `null` and rendered as `—`; no value is invented.

### Per-platform notes

- **Linux**: plain file reads — no subprocess.
- **macOS**: short `sysctl`/`netstat` calls plus Node APIs; the temperature probe is expensive, so it
  refreshes every fifth sample and is cached between them.
- **Windows**: one long-lived PowerShell child streams one JSON line per second (the performance
  counters already report percentages and per-second byte rates, so no deltas are needed). If the
  child exits it restarts after a five-second backoff and the last sample is reused meanwhile.
- Any other platform falls back to a minimal Node-only reading (memory, load, uptime); CPU load and
  throughput render `—`.

## Usage

### Reordering

Every reading is an independently selectable cell:

- **Drag** a reading to another slot; slots swap live while dragging and the order is committed on drop.
- **Keyboard**: focus a cell with Tab and move it with `←` / `→` (`Enter` / `Space` selects).
- **Persistence**: the order is stored in `localStorage` under `dsh-system-vitals:order` and survives
  reloads.

Cells are equal width and dragging leaves **no placeholder**, so the strip's width and position are
identical in every order — only which reading occupies which slot changes.

### Choosing which readings appear

**Settings → System Vitals** lists every reading with a switch:

- Uncheck a reading to hide it; a live preview shows the resulting strip.
- `Show all` restores everything; the Order group offers `Reset order`.
- Preferences live in `localStorage` (`dsh-system-vitals:visible` / `:order`) and survive reloads.

Visibility is **your** choice, never the window's: resizing never changes what is shown or in which
order. On a narrow window, hide the readings you do not care about.

## Placement, width and wrapping

The strip registers in `conversation.input.right`, inside the `.trailing` flex cluster with the submit
button. The host row is `flex-wrap: wrap` and measures itself (`observeControlRow`) to decide whether
the model seat goes compact — **the strip's width counts toward that measurement**, while `.trailing`
is `flex: none`. The strip must therefore yield, or the row wraps and pushes the permission control and
the submit button away: it is capped at the row's leftover width and clips its own cells beyond that.

The cap is measured at runtime rather than hardcoded: a `ResizeObserver` reads the row's **content
box** — the same box the host compares its own "does it fit" sum against — subtracts every control
outside the strip's own ancestor branch plus the gaps, and keeps an 8px safety margin. The model seat
counts at its compact width, because the host collapses it to an icon when space runs short; planning
for its expanded label starved the strip and then prevented the host from ever compacting.

The important part is *when* the cap takes effect: it is written to the element's style from inside the
observer callback, not routed through `setState`. A React state update is committed in a later task,
after the frame has already been painted — so every resize step used to paint one frame with the strip
at its old width, and that overflow squashed the row's shrinkable native controls or pushed the cluster
onto a second line before snapping back. Writing the style in the callback keeps the correction inside
the same rendering update, so no painted frame shows an over-wide strip. (Regression numbers are in
[CHANGELOG.md](CHANGELOG.md), entries 1.3.11 and 1.3.13.)

Typical behaviour (row → visible readings; the numbers drift a little with the font and the host
version): 396px→1; 500px→2; 620px→4; 900px and above→6. The strip is always **one line**: when it does
not fit it clips at the right edge, so the **leading** readings survive — the head of your own order —
and the cut always falls between two cells.

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

- **Platform**: full support on Linux; macOS and Windows cover CPU, memory, disk and throughput, with
  temperature depending on the model and permissions.
- **DSH**: developed and verified on `0.2.1-rc.2`, using only stable `webServer.register`,
  `ctx.slots.register/inject` and `ctx.locale.register` APIs.
- **Node**: ≥ 20 (`fs.statfs`).

## Security

`GET /system-vitals/api/snapshot` is an **unauthenticated, local-only** route served by the DSH web
listener (bound to `127.0.0.1` by default). Any local process can read `/proc` anyway, so this adds no
real exposure — but do not expose the DSH Web UI publicly (`--host 0.0.0.0`) with this plugin installed.

## Layout

```
dsh-system-vitals/
├── package.json          # dsh.bundle / dsh.client / exports
├── cordis.patch.yml      # inserts the plugin row
├── index.js              # Host half: sampling and HTTP route
├── client.js             # Client half: the strip and the settings page
├── platform/             # linux / darwin / win32 samplers
├── locale/{zh,en}.json   # display metadata for the plugin inventory
├── docs/preview.png      # screenshot
├── icon.svg              # plugin icon
└── CHANGELOG.md / README.md / README.en.md / LICENSE
```

## Development and publishing

```bash
node --check index.js
node --check client.js
for file in platform/*.js; do node --check "$file"; done
npm pack --dry-run
```

Reinstall a local checkout after changes:

```bash
dsh plugin --profile web remove dsh-system-vitals
dsh plugin --profile web add /home/abyss/app/system-vitals
```

Release flow: bump `package.json`, update `CHANGELOG.md`, commit, tag `vX.Y.Z`, then publish a GitHub
Release for that tag. `.github/workflows/publish.yml` verifies the tag against `package.json` and runs
`npm publish --provenance` only when the repository has an `NPM_TOKEN` secret; without it the npm step
is skipped with a notice (**releases are GitHub-only today; nothing is published to npm**).

## License

[MIT](LICENSE)
