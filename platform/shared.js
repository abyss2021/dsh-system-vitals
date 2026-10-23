/**
 * Platform-independent helpers shared by the per-OS metric sources.
 */
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'

export async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export async function safeReaddir(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

/** Run a command with a hard timeout; resolves to null on any failure. */
export function run(command, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout)
    })
  })
}

export function toCelsius(raw) {
  if (raw === null || raw === undefined) return null
  const milli = Number(String(raw).trim())
  if (!Number.isFinite(milli) || milli <= 0) return null
  return Math.round(milli / 100) / 10
}
