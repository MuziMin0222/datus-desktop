import { useEffect, useState } from 'react'

import type { BootstrapSnapshot, PermissionProfile, UpdateStatus } from '@shared/ipc'
import { apiGet, apiPost, apiPut } from '../api/client'

interface Props {
  snapshot: BootstrapSnapshot
  onClose: () => void
  onReconfigure: () => void
  onRefresh: () => Promise<void>
}

interface AgentConfigSummary {
  target?: string
  models?: Record<string, Record<string, unknown>>
  datasources?: Record<string, Record<string, unknown>>
  current_datasource?: string
}

const PROFILES: PermissionProfile[] = ['normal', 'auto', 'dangerous']
const MODEL_TYPES = ['openai', 'claude', 'deepseek', 'qwen', 'gemini', 'glm', 'kimi', 'minimax', 'openrouter']
const DS_TYPES = ['sqlite', 'duckdb', 'snowflake', 'starrocks', 'postgresql', 'mysql']

function describeUpdate(status: UpdateStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Not checked yet'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${status.version ?? ''} found, downloading…`
    case 'downloading':
      return `Downloading ${status.percent ?? 0}%`
    case 'downloaded':
      return `Version ${status.version ?? ''} ready — restart to install`
    case 'up-to-date':
      return 'You are up to date'
    case 'error':
      return status.message || 'Update check failed'
    case 'disabled':
      return status.message || 'Updates are disabled'
  }
}

export function SettingsPanel({ snapshot, onClose, onReconfigure, onRefresh }: Props) {
  const baseUrl = snapshot.connection.baseUrl as string
  const [logs, setLogs] = useState<string | null>(null)
  const [profile, setProfile] = useState<PermissionProfile>(snapshot.settings.permissionProfile)
  const [agentConfig, setAgentConfig] = useState<AgentConfigSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [modelName, setModelName] = useState('')
  const [modelType, setModelType] = useState('openai')
  const [modelId, setModelId] = useState('')
  const [modelBaseUrl, setModelBaseUrl] = useState('')
  const [modelApiKey, setModelApiKey] = useState('')

  const [dsName, setDsName] = useState('')
  const [dsType, setDsType] = useState('sqlite')
  const [dsUri, setDsUri] = useState('')
  const [dsHost, setDsHost] = useState('')
  const [dsPort, setDsPort] = useState('')
  const [dsUser, setDsUser] = useState('')
  const [dsPassword, setDsPassword] = useState('')
  const [dsDatabase, setDsDatabase] = useState('')
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    void window.datus.getUpdateStatus().then(setUpdate)
    return window.datus.onUpdateStatus(setUpdate)
  }, [])

  useEffect(() => {
    apiGet<AgentConfigSummary>(baseUrl, '/api/v1/config/agent')
      .then(setAgentConfig)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [baseUrl])

  async function loadLogs(): Promise<void> {
    setLogs((await window.datus.readLogs()) || 'No logs yet.')
  }

  async function saveProfile(next: PermissionProfile): Promise<void> {
    setProfile(next)
    await window.datus.setPermissionProfile(next)
    await onRefresh()
  }

  function modelPayload(): Record<string, unknown> {
    return {
      type: modelType,
      model: modelId,
      ...(modelBaseUrl.trim() ? { base_url: modelBaseUrl.trim() } : {}),
      ...(modelApiKey.trim() ? { api_key: modelApiKey.trim() } : {})
    }
  }

  async function testModel(): Promise<void> {
    setError(null)
    setMessage(null)
    try {
      const result = await apiPost<{ ok: boolean; message?: string }>(
        baseUrl,
        '/api/v1/config/models/test',
        modelPayload()
      )
      if (result.ok) setMessage('Model reachable.')
      else setError(result.message || 'Model probe failed')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function saveModel(): Promise<void> {
    setError(null)
    setMessage(null)
    if (!modelName.trim() || !modelId.trim()) {
      setError('Model alias and model id are required.')
      return
    }
    try {
      const models = { ...(agentConfig?.models ?? {}), [modelName.trim()]: modelPayload() }
      await apiPut(baseUrl, '/api/v1/config/models', { models, target: modelName.trim() })
      setAgentConfig({ ...(agentConfig ?? {}), models, target: modelName.trim() })
      setMessage(`Saved model "${modelName.trim()}" and made it the active target.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function saveDatasource(): Promise<void> {
    setError(null)
    setMessage(null)
    if (!dsName.trim()) {
      setError('Datasource name is required.')
      return
    }
    const entry: Record<string, unknown> = { type: dsType }
    if (dsType === 'sqlite' || dsType === 'duckdb') {
      if (!dsUri.trim()) {
        setError('A database path is required.')
        return
      }
      entry.uri = dsUri.trim()
    } else {
      entry.host = dsHost.trim()
      if (dsPort.trim()) entry.port = Number(dsPort.trim())
      entry.username = dsUser.trim()
      if (dsPassword) entry.password = dsPassword
      entry.database = dsDatabase.trim()
    }
    try {
      const datasources = { ...(agentConfig?.datasources ?? {}), [dsName.trim()]: entry }
      await apiPut(baseUrl, '/api/v1/config/datasources', { datasources })
      setAgentConfig({ ...(agentConfig ?? {}), datasources })
      setMessage(`Saved datasource "${dsName.trim()}".`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="fixed inset-0 z-10 grid place-items-center overflow-auto bg-black/60 p-6" onClick={onClose}>
      <div className="panel my-8 w-full max-w-2xl p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Connection</h3>
          <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
            <dt className="text-[var(--muted)]">Mode</dt>
            <dd>{snapshot.connection.mode}</dd>
            <dt className="text-[var(--muted)]">Server</dt>
            <dd className="break-all">{snapshot.connection.baseUrl ?? '—'}</dd>
            <dt className="text-[var(--muted)]">Agent version</dt>
            <dd>{snapshot.connection.version ?? '—'}</dd>
            <dt className="text-[var(--muted)]">Workspace</dt>
            <dd className="break-all">{snapshot.settings.workspace ?? 'default'}</dd>
          </dl>
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-[var(--muted)]">Permission profile</label>
              <select
                className="input"
                value={profile}
                onChange={(event) => void saveProfile(event.target.value as PermissionProfile)}
              >
                {PROFILES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn" onClick={loadLogs}>
              View logs
            </button>
            <button className="btn" onClick={onReconfigure}>
              Change connection
            </button>
          </div>
          {logs !== null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-black/40 p-3 text-[11px] text-[var(--muted)]">
              {logs}
            </pre>
          )}
        </section>

        <section className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Updates</h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Version {snapshot.appVersion} · {describeUpdate(update)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="btn"
              disabled={update.state === 'checking' || update.state === 'disabled'}
              onClick={() => void window.datus.checkForUpdates().then(setUpdate)}
            >
              Check for updates
            </button>
            {update.state === 'downloaded' && (
              <button className="btn btn-primary" onClick={() => void window.datus.installUpdate()}>
                Restart to install
              </button>
            )}
          </div>
          {update.state === 'error' && <p className="mt-2 text-xs text-[var(--danger)]">{update.message}</p>}
        </section>

        <section className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Model</h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Active target: {agentConfig?.target || 'none'} · configured:{' '}
            {Object.keys(agentConfig?.models ?? {}).join(', ') || 'none'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="alias (e.g. my-gpt)"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
            <select className="input" value={modelType} onChange={(event) => setModelType(event.target.value)}>
              {MODEL_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="model id (e.g. gpt-4.1)"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
            />
            <input
              className="input"
              placeholder="base_url (optional)"
              value={modelBaseUrl}
              onChange={(event) => setModelBaseUrl(event.target.value)}
            />
            <input
              className="input col-span-2"
              type="password"
              placeholder="api key (optional if provider env var is set)"
              value={modelApiKey}
              onChange={(event) => setModelApiKey(event.target.value)}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button className="btn" onClick={testModel}>
              Test
            </button>
            <button className="btn btn-primary" onClick={saveModel}>
              Save &amp; activate
            </button>
          </div>
        </section>

        <section className="mt-5 border-t border-[var(--border)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Datasources</h3>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Active: {agentConfig?.current_datasource || 'none'} · configured:{' '}
            {Object.entries(agentConfig?.datasources ?? {})
              .map(([name, config]) => `${name} (${String(config.type ?? '?')})`)
              .join(', ') || 'none'}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="name"
              value={dsName}
              onChange={(event) => setDsName(event.target.value)}
            />
            <select className="input" value={dsType} onChange={(event) => setDsType(event.target.value)}>
              {DS_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            {dsType === 'sqlite' || dsType === 'duckdb' ? (
              <input
                className="input col-span-2"
                placeholder={dsType === 'sqlite' ? '/path/to/database.sqlite' : '/path/to/database.duckdb'}
                value={dsUri}
                onChange={(event) => setDsUri(event.target.value)}
              />
            ) : (
              <>
                <input
                  className="input"
                  placeholder="host"
                  value={dsHost}
                  onChange={(event) => setDsHost(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="port"
                  value={dsPort}
                  onChange={(event) => setDsPort(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="username"
                  value={dsUser}
                  onChange={(event) => setDsUser(event.target.value)}
                />
                <input
                  className="input"
                  type="password"
                  placeholder="password"
                  value={dsPassword}
                  onChange={(event) => setDsPassword(event.target.value)}
                />
                <input
                  className="input col-span-2"
                  placeholder="database"
                  value={dsDatabase}
                  onChange={(event) => setDsDatabase(event.target.value)}
                />
              </>
            )}
          </div>
          <div className="mt-2">
            <button className="btn btn-primary" onClick={saveDatasource}>
              Add datasource
            </button>
          </div>
        </section>

        {message && <p className="mt-3 text-xs text-emerald-400">{message}</p>}
        {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </div>
  )
}
