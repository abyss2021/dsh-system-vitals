/**
 * Windows metric source.
 *
 * A long-lived PowerShell child streams one JSON sample per second from the
 * `Win32_PerfFormattedData_*` performance classes, which already report
 * percentages and per-second byte rates — no counter deltas needed. Static
 * host facts (CPU name, logical cores, boot time) are captured once per child.
 *
 * The child is restarted with backoff if it exits, so a transient failure
 * degrades to a stale sample instead of breaking the plugin.
 */
import os from 'node:os'
import { spawn } from 'node:child_process'

const POWERSHELL = 'powershell.exe'
const RESTART_DELAY_MS = 5000

/** One streaming sampling loop; emits a compact JSON object per second. */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cpuName = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$cores = (Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum
$systemDrive = $env:SystemDrive
if (-not $systemDrive) { $systemDrive = 'C:' }
while ($true) {
  $p = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor
  $totalInstance = $p | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
  $perCore = @($p | Where-Object { $_.Name -ne '_Total' } | Sort-Object { [int]$_.Name } | ForEach-Object { [int]$_.PercentProcessorTime })
  $m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object -First 1
  $osInfo = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1
  $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$systemDrive'" | Select-Object -First 1
  $netRx = 0
  $netTx = 0
  foreach ($n in (Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)) {
    if ($n.Name -match 'loopback|isatap|teredo|tunnel|pseudo|bluetooth|vmware|hyper-v|vethernet') { continue }
    $netRx += [double]$n.BytesReceivedPersec
    $netTx += [double]$n.BytesSentPersec
  }
  $tempC = $null
  try {
    $zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature
    $raw = ($zones | Measure-Object CurrentTemperature -Maximum).Maximum
    if ($raw) { $tempC = [math]::Round(($raw / 10) - 273.15, 1) }
  } catch {}
  if (-not $tempC) {
    try {
      $tz = Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation | Where-Object { $_.HighPrecisionTemperature -gt 0 } | Select-Object -First 1
      if ($tz) { $tempC = [math]::Round(($tz.HighPrecisionTemperature / 10) - 273.15, 1) }
    } catch {}
  }
  $uptime = [double]([DateTime]::Now - $osInfo.LastBootUpTime).TotalSeconds
  $obj = [ordered]@{
    t = [int64](([DateTimeOffset]::Now).ToUnixTimeMilliseconds())
    cpuPercent = [double]($totalInstance.PercentProcessorTime)
    perCore = $perCore
    cpuName = $cpuName
    cores = [int]$cores
    memTotalKB = [double]$m.TotalVisibleMemorySize
    memFreeKB = [double]$m.AvailableKB
    committedKB = [double]$m.CommittedBytes / 1024
    commitLimitKB = [double]$m.CommitLimit / 1024
    diskTotal = [double]$disk.Size
    diskFree = [double]$disk.FreeSpace
    netRx = $netRx
    netTx = $netTx
    tempC = $tempC
    uptime = $uptime
    processes = [int]$osInfo.NumberOfProcesses
  }
  ConvertTo-Json -Compress -InputObject $obj
  Start-Sleep -Seconds 1
}
`

export const platform = 'win32'

function createStream() {
  const child = spawn(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return child
}

export function createSource() {
  let child = null
  let buffer = ''
  let latest = null
  let restartAt = 0

  const ensureChild = () => {
    if (child !== null) return
    if (Date.now() < restartAt) return
    try {
      child = createStream()
    } catch {
      child = null
      restartAt = Date.now() + RESTART_DELAY_MS
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line.startsWith('{')) {
          try {
            latest = JSON.parse(line)
          } catch {
            /* Skip a malformed line; the next sample replaces it. */
          }
        }
        index = buffer.indexOf('\n')
      }
      if (buffer.length > 64 * 1024) buffer = ''
    })
    const onExit = () => {
      child = null
      buffer = ''
      restartAt = Date.now() + RESTART_DELAY_MS
    }
    child.on('error', onExit)
    child.on('exit', onExit)
  }

  return {
    dispose() {
      child?.kill()
      child = null
    },
    async read() {
      ensureChild()
      if (latest === null) return null

      const memoryTotal = latest.memTotalKB * 1024
      const memoryFree = latest.memFreeKB * 1024
      const swapTotal = latest.commitLimitKB * 1024
      const swapUsed = latest.committedKB * 1024
      const perCore = Array.isArray(latest.perCore) ? latest.perCore : []

      return {
        t: latest.t,
        host: os.hostname(),
        cpu: {
          percent: Number(latest.cpuPercent) || 0,
          perCore,
          cores: Number(latest.cores) || perCore.length || os.cpus().length,
          model: latest.cpuName ?? undefined,
        },
        mem: {
          total: memoryTotal,
          used: Math.max(0, memoryTotal - memoryFree),
          percent: memoryTotal > 0 ? ((memoryTotal - memoryFree) / memoryTotal) * 100 : 0,
          swapTotal,
          swapUsed,
        },
        load: os.loadavg(),
        running: 0,
        tasks: 0,
        count: Number.isFinite(latest.processes) ? latest.processes : null,
        uptime: Number(latest.uptime) || 0,
        disk:
          Number(latest.diskTotal) > 0
            ? {
                total: latest.diskTotal,
                free: latest.diskFree,
                used: Math.max(0, latest.diskTotal - latest.diskFree),
                percent: ((latest.diskTotal - latest.diskFree) / latest.diskTotal) * 100,
              }
            : null,
        temperature: Number.isFinite(latest.tempC) ? latest.tempC : null,
        net: { rx: Number(latest.netRx) || 0, tx: Number(latest.netTx) || 0 },
      }
    },
  }
}
