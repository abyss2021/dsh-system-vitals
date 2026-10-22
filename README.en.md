# dsh-system-vitals

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux-6c757d)](#compatibility)

**System vitals for DeepSeek Harness.** A single always-visible status line inside the
composer tool row — right next to the permission control — showing **CPU load, CPU
temperature, memory, disk and live upload/download throughput**. Sampled every second,
zero runtime dependencies.

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
# from GitHub
dsh plugin --profile web add github:<your-account>/dsh-system-vitals

# or from a local checkout
dsh plugin --profile web add /path/to/dsh-system-vitals
```

Refresh the page afterwards. Uninstall:

```bash
dsh plugin --profile web remove dsh-system-vitals
```

> The package is a **bundle plus a Client half**: the Host side samples and serves one
> same-origin HTTP route, the Client side registers a React component into
> `conversation.input.left`. There is no build step — `client.js` is a browser module the
> Harness module loader can execute directly.

## What it shows

| Reading | Source | Notes |
|---|---|---|
| CPU load (total, per core) | `/proc/stat` | delta between two samples |
| CPU temperature | `/sys/class/hwmon/*/name` (`coretemp`, `k10temp`, `zenpower`, `cpu_thermal`, …) → `temp1_input`; falls back to `/sys/class/thermal/thermal_zone*/temp` | prefers a CPU package sensor; shows `—` when unavailable |
| Memory / swap | `/proc/meminfo` | the line shows the percentage; absolute usage is in the tooltip |
| Disk usage | `fs.statfs('/')` | root volume |
| Upload / download | `/proc/net/dev` counter deltas | virtual interfaces (`lo`, `veth`, `docker`, `br-`, `tun`, `wg`, …) excluded |
| (Host-only extras) load average, task count, uptime | `/proc/loadavg`, `/proc`, `/proc/uptime` | present in the snapshot, not rendered today |

The Host samples once a second; the Client polls `GET /system-vitals/api/snapshot` every two seconds.

## Narrow windows

The composer tool row is already an inline-size container, and the plugin queries it
directly — never its own width, which would collapse to zero inside the content-sized cluster:

| Card width | Shown |
|---|---|
| > 860px | all six readings |
| ≤ 860px | upload/download hidden |
| ≤ 620px | disk hidden as well; CPU, temperature and memory remain |

Hidden readings stay available in the tooltip.

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

- **Platform**: Linux (`/proc` and `/sys`; other platforms will show gaps).
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

## Development

```bash
node --check index.js
node --check client.js
npm pack --dry-run
```

Reinstall after changes:

```bash
dsh plugin --profile web remove dsh-system-vitals
dsh plugin --profile web add /path/to/dsh-system-vitals
```

## License

[MIT](LICENSE)
