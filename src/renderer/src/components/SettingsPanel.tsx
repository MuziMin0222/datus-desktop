import { useCallback, useEffect, useState } from 'react'

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
  target_provider?: string
  target_model?: string
  models?: Record<string, Record<string, unknown>>
  datasources?: Record<string, Record<string, unknown>>
  current_datasource?: string
}

type SettingsTab = 'connection' | 'models' | 'datasources' | 'updates'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'connection', label: 'Connection' },
  { id: 'models', label: 'Models' },
  { id: 'datasources', label: 'Datasources' },
  { id: 'updates', label: 'Updates' }
]

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
  const [tab, setTab] = useState<SettingsTab>('connection')
  const [logs, setLogs] = useState<string | null>(null)
  const [profile, setProfile] = useState<PermissionProfile>(snapshot.settings.permissionProfile)
  const [agentConfig, setAgentConfig] = useState<AgentConfigSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [showModelForm, setShowModelForm] = useState(false)
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

  const loadAgentConfig = useCallback(async () => {
    const data = await apiGet<AgentConfigSummary>(baseUrl, '/api/v1/config/agent')
    setAgentConfig(data)
  }, [baseUrl])

  useEffect(() => {
    void window.datus.getUpdateStatus().then(setUpdate)
    return window.datus.onUpdateStatus(setUpdate)
  }, [])

  useEffect(() => {
    void loadAgentConfig().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [loadAgentConfig])

  function switchTab(next: SettingsTab): void {
    setTab(next)
    setMessage(null)
    setError(null)
  }

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
      const alias = modelName.trim()
      await apiPut(baseUrl, '/api/v1/config/models', {
        models: { ...(agentConfig?.models ?? {}), [alias]: modelPayload() },
        target: alias
      })
      await loadAgentConfig()
      setShowModelForm(false)
      setModelName('')
      setModelId('')
      setModelBaseUrl('')
      setModelApiKey('')
      setMessage(`Saved model "${alias}" and made it the active target.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function activateModel(alias: string): Promise<void> {
    setError(null)
    setMessage(null)
    try {
      await apiPut(baseUrl, '/api/v1/config/models', { target: alias })
      await loadAgentConfig()
      setMessage(`Active model: ${alias}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function deleteModel(alias: string): Promise<void> {
    setError(null)
    setMessage(null)
    const models = { ...(agentConfig?.models ?? {}) }
    if (!window.confirm(`Delete model "${alias}"?`)) return
    delete models[alias]
    const providerTarget = Boolean(agentConfig?.target_provider && agentConfig?.target_model)
    const payload: { models: Record<string, Record<string, unknown>>; target?: string | null } = { models }
    if (!providerTarget && alias === agentConfig?.target) {
      payload.target = Object.keys(models)[0] ?? null
    }
    try {
      await apiPut(baseUrl, '/api/v1/config/models', payload)
      await loadAgentConfig()
      setMessage(`Deleted model "${alias}".`)
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
      await apiPut(baseUrl, '/api/v1/config/datasources', {
        datasources: { ...(agentConfig?.datasources ?? {}), [dsName.trim()]: entry }
      })
      await loadAgentConfig()
      setMessage(`Saved datasource "${dsName.trim()}".`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function deleteDatasource(name: string): Promise<void> {
    setError(null)
    setMessage(null)
    const datasources = { ...(agentConfig?.datasources ?? {}) }
    if (!window.confirm(`Delete datasource "${name}"?`)) return
    delete datasources[name]
    if (name === agentConfig?.current_datasource) {
      const next = Object.keys(datasources)[0]
      for (const key of Object.keys(datasources)) {
        datasources[key] = { ...datasources[key], default: key === next }
      }
    }
    try {
      await apiPut(baseUrl, '/api/v1/config/datasources', { datasources })
      await loadAgentConfig()
      setMessage(`Deleted datasource "${name}".`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const modelEntries = Object.entries(agentConfig?.models ?? {})
  const providerTarget =
    agentConfig?.target_provider && agentConfig?.target_model
      ? `${agentConfig.target_provider}/${agentConfig.target_model}`
      : ''
  const activeTarget = providerTarget ? '' : (agentConfig?.target ?? '')

  return (
    <div className="fixed inset-0 z-10 grid place-items-center overflow-auto bg-black/60 p-6" onClick={onClose}>
      <div
        className="panel my-8 flex max-h-[85vh] w-full max-w-3xl flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-40 shrink-0 space-y-1 border-r border-[var(--border)] p-3">
            {TABS.map((item) => (
              <button
                key={item.id}
                className={`w-full rounded-lg px-3 py-2 text-left text-xs ${
                  tab === item.id ? 'bg-[#16202b] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[#131c25]'
                }`}
                onClick={() => switchTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {tab === 'connection' && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Connection</h3>
                <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
                  <dt className="text-[var(--muted)]">Mode</dt>
                  <dd>{snapshot.connection.mode}</dd>
                  <dt className="text-[var(--muted)]">Server</dt>
                  <dd className="break-all">{snapshot.connection.baseUrl ?? '—'}</dd>
                  <dt className="text-[var(--muted)]">Agent version</dt>
                  <dd>{snapshot.connection.version ?? '—'}</dd>
                  <dt className="text-[var(--muted)]">Workspace</dt>
                  <dd className="break-all">{snapshot.settings.workspace ?? 'default'}</dd>
                </dl>
                <div className="mt-4 flex items-end gap-2">
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
                  <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-[var(--border)] bg-black/40 p-3 text-[11px] text-[var(--muted)]">
                    {logs}
                  </pre>
                )}
              </section>
            )}

            {tab === 'models' && (
              <section>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">Models</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Manage custom models with your own API key. Active target: {activeTarget || providerTarget || 'none'}
                    </p>
                  </div>
                  <button className="btn btn-primary" onClick={() => setShowModelForm((value) => !value)}>
                    + Add model
                  </button>
                </div>

                {message && (
                  <p role="status" aria-live="polite" className="mt-3 text-xs text-emerald-400">
                    {message}
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
                    {error}
                  </p>
                )}

                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
                  {modelEntries.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-[var(--muted)]">
                      No models configured yet. Add one to start chatting.
                    </div>
                  )}
                  {modelEntries.map(([alias, config]) => {
                    const active = alias === activeTarget
                    const base = typeof config.base_url === 'string' ? config.base_url : ''
                    return (
                      <div
                        key={alias}
                        className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
                      >
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1b2733] text-xs">
                          ✦
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{alias}</div>
                          <div className="truncate text-[11px] text-[var(--muted)]">
                            {String(config.type ?? '')} · {String(config.model ?? '')}
                            {base ? ` · ${base}` : ''}
                          </div>
                        </div>
                        {active && (
                          <span className="rounded-full bg-[#14351f] px-2 py-0.5 text-[10px] text-emerald-400">
                            active
                          </span>
                        )}
                        <input
                          type="radio"
                          name="active-model"
                          aria-label={`Activate ${alias}`}
                          title={active ? 'Already active' : `Use ${alias}`}
                          checked={active}
                          onChange={() => void activateModel(alias)}
                          onClick={() => {
                            if (!active) return
                            setError(null)
                            setMessage(`"${alias}" is already the active model.`)
                          }}
                          className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                        />
                        <button
                          type="button"
                          className="text-xs text-[var(--muted)] hover:text-[var(--danger)]"
                          aria-label={`Delete ${alias}`}
                          title={`Delete ${alias}`}
                          onClick={() => void deleteModel(alias)}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>

                {showModelForm && (
                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
                    <div className="text-sm font-medium">Add model</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <input
                        className="input"
                        placeholder="alias (e.g. my-gpt)"
                        value={modelName}
                        onChange={(event) => setModelName(event.target.value)}
                      />
                      <select
                        className="input"
                        value={modelType}
                        onChange={(event) => setModelType(event.target.value)}
                      >
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
                    <div className="mt-3 flex gap-2">
                      <button className="btn" onClick={testModel}>
                        Test
                      </button>
                      <button className="btn btn-primary" onClick={saveModel}>
                        Save &amp; activate
                      </button>
                      <button className="btn" onClick={() => setShowModelForm(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === 'datasources' && (
              <section>
                <h3 className="text-lg font-semibold">Datasources</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Active: {agentConfig?.current_datasource || 'none'} · configured:{' '}
                  {Object.keys(agentConfig?.datasources ?? {}).length}
                </p>

                {message && (
                  <p role="status" aria-live="polite" className="mt-3 text-xs text-emerald-400">
                    {message}
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
                    {error}
                  </p>
                )}

                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
                  {Object.entries(agentConfig?.datasources ?? {}).map(([name, config]) => {
                    const active = name === agentConfig?.current_datasource
                    return (
                      <div
                        key={name}
                        className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
                      >
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1b2733] text-xs">
                          DB
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{name}</div>
                          <div className="truncate text-[11px] text-[var(--muted)]">{String(config.type ?? '')}</div>
                        </div>
                        {active && (
                          <span className="rounded-full bg-[#14351f] px-2 py-0.5 text-[10px] text-emerald-400">
                            active
                          </span>
                        )}
                        <button
                          type="button"
                          className="text-xs text-[var(--muted)] hover:text-[var(--danger)]"
                          aria-label={`Delete ${name}`}
                          title={`Delete ${name}`}
                          onClick={() => void deleteDatasource(name)}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                  {Object.keys(agentConfig?.datasources ?? {}).length === 0 && (
                    <div className="px-4 py-8 text-center text-xs text-[var(--muted)]">No datasources configured.</div>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
                  <div className="text-sm font-medium">Add datasource</div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
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
                  <button className="btn btn-primary mt-3" onClick={saveDatasource}>
                    Add datasource
                  </button>
                </div>
              </section>
            )}

            {tab === 'updates' && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Updates</h3>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Version {snapshot.appVersion} · {describeUpdate(update)}
                </p>
                <div className="mt-3 flex gap-2">
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
            )}

            {tab !== 'models' && tab !== 'datasources' && message && (
              <p className="mt-4 text-xs text-emerald-400">{message}</p>
            )}
            {tab !== 'models' && tab !== 'datasources' && error && (
              <p className="mt-4 text-xs text-[var(--danger)]">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
