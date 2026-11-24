import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SETTINGS, type DesktopSettings, type PermissionProfile, type SaveConnectionInput } from '@shared/ipc'
import { dataRoot } from './sidecar/paths'

interface PersistedSettings {
  settings: DesktopSettings
  remoteTokenEncrypted?: string
  remoteTokenPlain?: string
}

let cached: PersistedSettings | null = null

function settingsFile(): string {
  return join(dataRoot(), 'settings.json')
}

function read(): PersistedSettings {
  if (cached) return cached
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Partial<PersistedSettings>
    cached = {
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      remoteTokenEncrypted: raw.remoteTokenEncrypted,
      remoteTokenPlain: raw.remoteTokenPlain
    }
  } catch {
    cached = { settings: { ...DEFAULT_SETTINGS } }
  }
  return cached
}

function write(): void {
  const dir = dataRoot()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsFile(), JSON.stringify(cached, null, 2), { mode: 0o600 })
}

export function getSettings(): DesktopSettings {
  return read().settings
}

export function updateSettings(input: SaveConnectionInput): DesktopSettings {
  const current = read()
  const next: DesktopSettings = {
    ...current.settings,
    mode: input.mode,
    workspace: input.workspace !== undefined ? input.workspace : current.settings.workspace,
    permissionProfile: (input.permissionProfile || current.settings.permissionProfile) as PermissionProfile,
    remote: {
      ...current.settings.remote,
      ...(input.remote
        ? {
            baseUrl: input.remote.baseUrl,
            userId: input.remote.userId,
            allowInsecureTls: Boolean(input.remote.allowInsecureTls)
          }
        : {})
    }
  }
  current.settings = next
  if (input.remote?.token !== undefined) {
    setRemoteTokenInternal(current, input.remote.token)
  }
  write()
  return next
}

export function setPermissionProfile(profile: PermissionProfile): DesktopSettings {
  const current = read()
  current.settings.permissionProfile = profile
  write()
  return current.settings
}

function setRemoteTokenInternal(state: PersistedSettings, token: string): void {
  const trimmed = token.trim()
  state.remoteTokenEncrypted = undefined
  state.remoteTokenPlain = undefined
  if (!trimmed) return
  if (safeStorage.isEncryptionAvailable()) {
    state.remoteTokenEncrypted = safeStorage.encryptString(trimmed).toString('base64')
  } else {
    // Linux without a keyring: keep the token readable only by the app user.
    state.remoteTokenPlain = trimmed
  }
}

export function setRemoteToken(token: string): void {
  const state = read()
  setRemoteTokenInternal(state, token)
  write()
}

export function getRemoteToken(): string | undefined {
  const state = read()
  if (state.remoteTokenEncrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(state.remoteTokenEncrypted, 'base64'))
    } catch {
      return undefined
    }
  }
  return state.remoteTokenPlain
}

export function hasRemoteToken(): boolean {
  return Boolean(getRemoteToken())
}
