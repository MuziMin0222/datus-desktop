import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { DesktopSettings } from '@shared/ipc'

export const isDev = !app.isPackaged || process.env.DATUS_DESKTOP_DEV === '1'

export function dataRoot(): string {
  return process.env.DATUS_DESKTOP_USER_DATA || app.getPath('userData')
}

export function paths(): {
  root: string
  runtimeDir: string
  venvDir: string
  pythonPath: string
  uvPath: string
  configPath: string
  datusHome: string
  logsDir: string
  logFile: string
  markerFile: string
  fastembedCache: string
  uvCache: string
} {
  const root = dataRoot()
  const runtimeDir = join(root, 'runtime')
  const venvDir = join(runtimeDir, 'venv')
  const datusHome = join(root, 'datus-home')
  const logsDir = join(root, 'logs')
  return {
    root,
    runtimeDir,
    venvDir,
    pythonPath: process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python'),
    uvPath: uvBinaryPath(),
    configPath: join(datusHome, 'conf', 'agent.yml'),
    datusHome,
    logsDir,
    logFile: join(logsDir, 'datus-api.log'),
    markerFile: join(runtimeDir, 'runtime.json'),
    fastembedCache: join(runtimeDir, 'fastembed'),
    uvCache: join(runtimeDir, 'uv-cache')
  }
}

export function ensureDirs(): void {
  const p = paths()
  for (const dir of [p.runtimeDir, p.logsDir, join(p.datusHome, 'conf'), p.fastembedCache, p.uvCache]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function resourcePath(...parts: string[]): string {
  const base = isDev ? join(app.getAppPath(), 'resources') : join(process.resourcesPath, 'resources')
  return join(base, ...parts)
}

function platformTriple(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `darwin-${arch}`
  if (process.platform === 'win32') return 'win32-x64'
  return `linux-${arch}`
}

export function uvBinaryPath(): string {
  const override = process.env.DATUS_UV_PATH
  if (override) return resolve(override)
  const name = process.platform === 'win32' ? 'uv.exe' : 'uv'
  return resourcePath('uv', platformTriple(), name)
}

export function devPythonPath(): string | undefined {
  const override = process.env.DATUS_DEV_PYTHON
  if (override) return override
  const repo = process.env.DATUS_REPO || resolve(app.getAppPath(), '..', 'Datus-agent')
  const candidate =
    process.platform === 'win32' ? join(repo, '.venv', 'Scripts', 'python.exe') : join(repo, '.venv', 'bin', 'python')
  return existsSync(candidate) ? candidate : undefined
}

export function localModeSupported(): boolean {
  if (isDev) return Boolean(devPythonPath())
  if (process.platform === 'win32') return false
  return process.platform === 'darwin' || process.platform === 'linux'
}

export function resolveWorkspace(settings: DesktopSettings): string {
  return settings.workspace || resolve(app.getPath('documents'), 'Datus')
}
