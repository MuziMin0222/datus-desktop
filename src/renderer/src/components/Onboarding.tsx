import { useState } from 'react'

import type { BootstrapSnapshot, PermissionProfile } from '@shared/ipc'

interface Props {
  snapshot: BootstrapSnapshot
  onRefresh: () => Promise<void>
  onConnected: () => void
}

const PROFILES: { value: PermissionProfile; label: string; hint: string }[] = [
  { value: 'normal', label: 'Normal', hint: 'Writes and shell commands ask first' },
  { value: 'auto', label: 'Auto', hint: 'Workspace writes and safe SQL run automatically' },
  { value: 'dangerous', label: 'Dangerous', hint: 'Almost everything runs without asking' }
]

export function Onboarding({ snapshot, onRefresh, onConnected }: Props) {
  const localSupported = snapshot.connection.localSupported
  const [mode, setMode] = useState<'local' | 'remote'>(localSupported ? snapshot.settings.mode : 'remote')
  const [workspace, setWorkspace] = useState(snapshot.settings.workspace ?? '')
  const [baseUrl, setBaseUrl] = useState(snapshot.settings.remote.baseUrl)
  const [token, setToken] = useState('')
  const [allowInsecure, setAllowInsecure] = useState(snapshot.settings.remote.allowInsecureTls)
  const [profile, setProfile] = useState<PermissionProfile>(snapshot.settings.permissionProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [logs, setLogs] = useState<string | null>(null)

  const status = snapshot.status
  const installing = ['verifying', 'installing-python', 'creating-venv', 'installing-agent', 'starting'].includes(
    status.state
  )

  async function browse(): Promise<void> {
    const dir = await window.datus.chooseWorkspace()
    if (dir) setWorkspace(dir)
  }

  async function testRemote(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await window.datus.testRemote({
      baseUrl,
      token: token || undefined,
      allowInsecureTls: allowInsecure
    })
    if (result.ok) setNotice(`Connected · datus-api ${result.version ?? 'unknown'}`)
    else setError(result.error ?? 'Connection failed')
    setBusy(false)
  }

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.datus.saveConnection({
        mode,
        workspace: workspace || null,
        permissionProfile: profile,
        remote: { baseUrl, token, allowInsecureTls: allowInsecure }
      })
      await onRefresh()
      onConnected()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function showLogs(): Promise<void> {
    const text = await window.datus.readLogs()
    setLogs(text || 'No logs yet.')
  }

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="panel w-full max-w-2xl p-7">
        <h1 className="text-xl font-semibold">Datus Desktop</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Connect to a local or remote Datus agent to start chatting with your data.
        </p>

        <div className="mt-6 flex gap-2">
          <button
            className={`btn ${mode === 'local' ? 'btn-primary' : ''}`}
            onClick={() => setMode('local')}
            disabled={!localSupported}
            title={localSupported ? '' : 'Local backend is not supported on this platform'}
          >
            Local backend
          </button>
          <button className={`btn ${mode === 'remote' ? 'btn-primary' : ''}`} onClick={() => setMode('remote')}>
            Remote server
          </button>
        </div>

        {mode === 'local' ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">Workspace folder</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={workspace}
                  onChange={(event) => setWorkspace(event.target.value)}
                  placeholder="~/Documents/Datus"
                />
                <button className="btn" onClick={browse}>
                  Browse…
                </button>
              </div>
            </div>
            <p className="text-xs text-[var(--muted)]">
              On first launch the app downloads Python 3.12 and installs the pinned datus-agent runtime. This can take a
              few minutes.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">datus-api URL</label>
              <input
                className="input"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://datus.example.com:8000"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">Access token</label>
              <input
                className="input"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={snapshot.hasRemoteToken ? 'Stored token (leave blank to keep)' : 'DATUS_API_TOKEN'}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={allowInsecure}
                onChange={(event) => setAllowInsecure(event.target.checked)}
              />
              Accept self-signed TLS certificates for this host
            </label>
            <button className="btn" onClick={testRemote} disabled={busy || !baseUrl}>
              Test connection
            </button>
          </div>
        )}

        <div className="mt-5">
          <label className="mb-1 block text-xs text-[var(--muted)]">Permission profile</label>
          <select
            className="input"
            value={profile}
            onChange={(event) => setProfile(event.target.value as PermissionProfile)}
          >
            {PROFILES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label} — {item.hint}
              </option>
            ))}
          </select>
        </div>

        {status.state !== 'idle' && (
          <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs">
            <div className="font-medium">{status.state}</div>
            {status.message && <div className="text-[var(--muted)]">{status.message}</div>}
            {status.error && <div className="text-[var(--danger)]">{status.error}</div>}
            {installing && <div className="mt-1 text-[var(--muted)]">This may take several minutes…</div>}
          </div>
        )}

        {notice && <p className="mt-3 text-xs text-emerald-400">{notice}</p>}
        {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={busy || installing || (mode === 'remote' && !baseUrl)}
          >
            {mode === 'local' ? 'Start local backend' : 'Connect'}
          </button>
          <button className="btn" onClick={showLogs}>
            View logs
          </button>
        </div>

        {logs !== null && (
          <pre className="mt-4 max-h-60 overflow-auto rounded-lg border border-[var(--border)] bg-black/40 p-3 text-[11px] text-[var(--muted)]">
            {logs}
          </pre>
        )}
      </div>
    </div>
  )
}
