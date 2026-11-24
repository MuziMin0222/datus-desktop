import type {
  BootstrapSnapshot,
  ConnectionInfo,
  DesktopSettings,
  SaveConnectionInput,
  SidecarStatus,
  TestRemoteInput,
  TestRemoteResult
} from '@shared/ipc'
import { getRemoteToken, hasRemoteToken, updateSettings } from './settings'
import { LocalBackend } from './sidecar/localBackend'
import { localModeSupported } from './sidecar/paths'

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    return new URL(withScheme).origin
  } catch {
    return ''
  }
}

export class BackendController {
  readonly local: LocalBackend
  settings: DesktopSettings
  private remoteBaseUrl: string | null = null
  private remoteReady = false
  private remoteVersion: string | undefined

  constructor(settings: DesktopSettings) {
    this.settings = settings
    this.local = new LocalBackend(() => this.settings)
    if (settings.mode === 'remote') {
      this.remoteBaseUrl = normalizeBaseUrl(settings.remote.baseUrl) || null
    }
  }

  async apply(settings: DesktopSettings): Promise<SidecarStatus> {
    this.settings = settings
    if (settings.mode === 'local') {
      this.remoteBaseUrl = null
      this.remoteReady = false
      this.remoteVersion = undefined
      return this.local.start()
    }
    await this.local.stop()
    this.remoteBaseUrl = normalizeBaseUrl(settings.remote.baseUrl) || null
    const result = this.remoteBaseUrl ? await this.verifyRemote(this.remoteBaseUrl) : { ok: false }
    this.remoteReady = result.ok
    this.remoteVersion = result.version
    return this.local.getStatus()
  }

  async verifyRemote(baseUrlInput?: string, tokenOverride?: string): Promise<TestRemoteResult> {
    const baseUrl = normalizeBaseUrl(baseUrlInput ?? this.remoteBaseUrl ?? this.settings.remote.baseUrl)
    if (!baseUrl) return { ok: false, error: 'No server URL configured' }
    const token = tokenOverride !== undefined ? tokenOverride : getRemoteToken()
    try {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch(`${baseUrl}/health/live`, { headers, signal: AbortSignal.timeout(5_000) })
      if (!response.ok) {
        return {
          ok: false,
          error: response.status === 401 ? 'Unauthorized: check the access token' : `HTTP ${response.status}`
        }
      }
      const body = (await response.json()) as { version?: string }
      return { ok: true, version: body.version }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async testRemote(input: TestRemoteInput): Promise<TestRemoteResult> {
    return this.verifyRemote(input.baseUrl, input.token)
  }

  getAuthTarget(): { baseUrl: string; token?: string; userId?: string } | null {
    if (this.settings.mode === 'local') return this.local.getAuth()
    if (!this.remoteBaseUrl) return null
    return {
      baseUrl: this.remoteBaseUrl,
      token: getRemoteToken(),
      userId: this.settings.remote.userId
    }
  }

  connectionInfo(): ConnectionInfo {
    const localSupported = localModeSupported()
    if (this.settings.mode === 'local') {
      const status = this.local.getStatus()
      return {
        mode: 'local',
        baseUrl: this.local.baseUrl,
        ready: status.state === 'ready',
        version: status.version,
        platform: process.platform,
        localSupported
      }
    }
    return {
      mode: 'remote',
      baseUrl: this.remoteBaseUrl,
      ready: this.remoteReady,
      version: this.remoteVersion,
      platform: process.platform,
      localSupported
    }
  }

  async save(input: SaveConnectionInput): Promise<BootstrapSnapshot> {
    const settings = updateSettings(input)
    await this.apply(settings)
    return this.snapshot()
  }

  snapshot(): BootstrapSnapshot {
    return {
      settings: this.settings,
      status: this.local.getStatus(),
      connection: this.connectionInfo(),
      hasRemoteToken: hasRemoteToken()
    }
  }
}
