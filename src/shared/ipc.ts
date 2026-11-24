export type PermissionProfile = 'normal' | 'auto' | 'dangerous'
export type ConnectionMode = 'local' | 'remote'

export interface RemoteSettings {
  baseUrl: string
  userId?: string
  allowInsecureTls: boolean
}

export interface DesktopSettings {
  mode: ConnectionMode
  workspace: string | null
  permissionProfile: PermissionProfile
  remote: RemoteSettings
}

export const DEFAULT_SETTINGS: DesktopSettings = {
  mode: 'local',
  workspace: null,
  permissionProfile: 'auto',
  remote: { baseUrl: '', allowInsecureTls: false }
}

export type SidecarState =
  | 'idle'
  | 'verifying'
  | 'installing-python'
  | 'creating-venv'
  | 'installing-agent'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopped'

export interface SidecarStatus {
  state: SidecarState
  message?: string
  progress?: number
  baseUrl?: string
  version?: string
  error?: string
}

export interface ConnectionInfo {
  mode: ConnectionMode
  baseUrl: string | null
  ready: boolean
  version?: string
  platform: string
  localSupported: boolean
}

export interface SaveConnectionInput {
  mode: ConnectionMode
  workspace?: string | null
  permissionProfile?: PermissionProfile
  remote?: {
    baseUrl: string
    token?: string
    userId?: string
    allowInsecureTls?: boolean
  }
}

export interface TestRemoteInput {
  baseUrl: string
  token?: string
  allowInsecureTls?: boolean
}

export interface TestRemoteResult {
  ok: boolean
  version?: string
  error?: string
}

export interface BootstrapSnapshot {
  settings: DesktopSettings
  status: SidecarStatus
  connection: ConnectionInfo
  hasRemoteToken: boolean
}

export interface ProxiedToolRequest {
  sessionId: string
  callToolId: string
  toolName: string
  params: Record<string, unknown>
}

export interface ToolExecutionResult {
  success: 0 | 1
  result?: unknown
  error?: string
}

export interface DesktopApi {
  getState(): Promise<BootstrapSnapshot>
  saveConnection(input: SaveConnectionInput): Promise<BootstrapSnapshot>
  chooseWorkspace(): Promise<string | null>
  testRemote(input: TestRemoteInput): Promise<TestRemoteResult>
  startLocal(): Promise<SidecarStatus>
  stopLocal(): Promise<SidecarStatus>
  setPermissionProfile(profile: PermissionProfile): Promise<void>
  executeProxiedTool(request: ProxiedToolRequest): Promise<ToolExecutionResult>
  onStatus(listener: (status: SidecarStatus) => void): () => void
  readLogs(): Promise<string>
}

export const IPC = {
  getState: 'datus:get-state',
  saveConnection: 'datus:save-connection',
  chooseWorkspace: 'datus:choose-workspace',
  testRemote: 'datus:test-remote',
  startLocal: 'datus:start-local',
  stopLocal: 'datus:stop-local',
  setPermissionProfile: 'datus:set-permission-profile',
  executeProxiedTool: 'datus:execute-proxied-tool',
  statusEvent: 'datus:status',
  readLogs: 'datus:read-logs'
} as const

declare global {
  interface Window {
    datus: DesktopApi
  }
}
