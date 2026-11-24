import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type WriteStream
} from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import type { DesktopSettings, SidecarStatus } from '@shared/ipc'
import { run, runCapture } from './exec'
import { devPythonPath, ensureDirs, isDev, localModeSupported, paths, resolveWorkspace, resourcePath } from './paths'

interface AgentPin {
  datusAgentVersion: string
  pythonVersion: string
}

type StatusListener = (status: SidecarStatus) => void

const HEALTH_TIMEOUT_MS = 90_000
const HEALTH_INTERVAL_MS = 300
const MAX_RESTARTS = 3

export class LocalBackend {
  private child: ChildProcess | null = null
  private status: SidecarStatus = { state: 'idle' }
  private listeners = new Set<StatusListener>()
  private logStream: WriteStream | null = null
  private recentLog: string[] = []
  private stopping = false
  private restartAttempts = 0
  private token = ''
  baseUrl: string | null = null

  constructor(private readonly settings: () => DesktopSettings) {}

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatus(): SidecarStatus {
    return this.status
  }

  getAuth(): { baseUrl: string; token: string } | null {
    return this.baseUrl ? { baseUrl: this.baseUrl, token: this.token } : null
  }

  readLogs(): string {
    return this.recentLog.join('\n')
  }

  private setStatus(status: SidecarStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }

  private log(line: string): void {
    const entry = `${new Date().toISOString()} ${line}`
    this.recentLog.push(entry)
    if (this.recentLog.length > 800) this.recentLog.splice(0, this.recentLog.length - 800)
    this.logStream?.write(`${entry}\n`)
  }

  async start(): Promise<SidecarStatus> {
    if (!localModeSupported()) {
      this.setStatus({
        state: 'failed',
        error: 'Local backend is not supported on this platform. Configure a remote server instead.'
      })
      return this.status
    }
    await this.stop()
    this.stopping = false
    try {
      ensureDirs()
      this.openLogStream()
      this.setStatus({ state: 'verifying', message: 'Checking local runtime' })
      const settings = this.settings()
      const workspace = resolveWorkspace(settings)
      if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true })
      const python = isDev ? this.resolveDevPython() : await this.ensureRuntime(settings)
      const port = await findFreePort()
      this.baseUrl = `http://127.0.0.1:${port}`
      this.token = randomBytes(24).toString('hex')
      this.writeConfig(settings)
      this.setStatus({ state: 'starting', message: `Starting datus-api on port ${port}` })
      this.spawnServer(python, workspace, port)
      const version = await this.waitForHealth()
      this.restartAttempts = 0
      this.setStatus({ state: 'ready', baseUrl: this.baseUrl, version })
      return this.status
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`startup failed: ${message}`)
      this.setStatus({ state: 'failed', error: message })
      return this.status
    }
  }

  async stop(): Promise<SidecarStatus> {
    this.stopping = true
    const child = this.child
    this.child = null
    if (child && child.pid) {
      this.log(`stopping datus-api (pid ${child.pid})`)
      if (process.platform === 'win32') {
        await run('taskkill', ['/pid', String(child.pid), '/T', '/F']).catch(() => undefined)
      } else {
        child.kill('SIGTERM')
        const exited = await waitForExit(child, 5_000)
        if (!exited) child.kill('SIGKILL')
      }
    }
    this.baseUrl = null
    this.logStream?.end()
    this.logStream = null
    this.setStatus({ state: 'stopped' })
    return this.status
  }

  private openLogStream(): void {
    const p = paths()
    ensureDirs()
    this.logStream = createWriteStream(p.logFile, { flags: 'a' })
  }

  private resolveDevPython(): string {
    const python = devPythonPath()
    if (!python) {
      throw new Error(
        'Dev mode needs a Python runtime: set DATUS_DEV_PYTHON or run `uv sync` in the Datus-agent repository.'
      )
    }
    return python
  }

  private readPin(): AgentPin {
    const file = resourcePath('agent-pin.json')
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as AgentPin
    if (!raw.datusAgentVersion || !raw.pythonVersion) {
      throw new Error(`Invalid agent pin file: ${file}`)
    }
    return raw
  }

  private async ensureRuntime(settings: DesktopSettings): Promise<string> {
    const p = paths()
    const pin = this.readPin()
    if (existsSync(p.markerFile) && existsSync(p.pythonPath)) {
      try {
        const marker = JSON.parse(readFileSync(p.markerFile, 'utf-8')) as AgentPin
        const installed = await runCapture(p.pythonPath, ['-c', 'import datus; print(datus.__version__)'])
        if (marker.datusAgentVersion === pin.datusAgentVersion && installed === pin.datusAgentVersion) {
          this.log(`runtime up to date: datus-agent ${installed}`)
          return p.pythonPath
        }
      } catch (error) {
        this.log(`existing runtime unusable: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (!existsSync(p.uvPath)) {
      throw new Error(`uv binary not found at ${p.uvPath}. Run \`npm run fetch:uv\` before building the app.`)
    }

    const uvEnv = {
      UV_CACHE_DIR: p.uvCache,
      UV_PYTHON_INSTALL_DIR: join(p.runtimeDir, 'python')
    }
    const extraIndex = process.env.DATUS_PIP_INDEX
    const pipArgs = ['pip', 'install', '--python', p.pythonPath, `datus-agent==${pin.datusAgentVersion}`]
    if (extraIndex) pipArgs.push('--index-url', extraIndex)

    this.setStatus({ state: 'installing-python', message: `Installing Python ${pin.pythonVersion}` })
    await run(p.uvPath, ['python', 'install', pin.pythonVersion], {
      env: uvEnv,
      onLine: (line) => this.log(`[uv] ${line}`)
    })

    this.setStatus({ state: 'creating-venv', message: 'Creating application virtualenv' })
    if (existsSync(p.venvDir)) rmSync(p.venvDir, { recursive: true, force: true })
    await run(p.uvPath, ['venv', '--python', pin.pythonVersion, p.venvDir], {
      env: uvEnv,
      onLine: (line) => this.log(`[uv] ${line}`)
    })

    this.setStatus({ state: 'installing-agent', message: `Installing datus-agent ${pin.datusAgentVersion}` })
    await run(p.uvPath, pipArgs, {
      env: uvEnv,
      onLine: (line) => this.log(`[uv] ${line}`)
    })

    writeFileSync(p.markerFile, JSON.stringify(pin, null, 2))
    this.log(`runtime installed: datus-agent ${pin.datusAgentVersion}`)
    return p.pythonPath
  }

  private writeConfig(settings: DesktopSettings): void {
    const p = paths()
    const file = p.configPath
    let data: Record<string, unknown>
    if (existsSync(file)) {
      try {
        data = (parseYaml(readFileSync(file, 'utf-8')) as Record<string, unknown>) || {}
      } catch {
        data = {}
      }
    } else {
      const template = readFileSync(resourcePath('config', 'base.agent.yml'), 'utf-8')
        .replaceAll('__DATUS_HOME__', p.datusHome)
        .replaceAll('__PERMISSION_PROFILE__', settings.permissionProfile)
      data = (parseYaml(template) as Record<string, unknown>) || {}
    }
    const agent = (data.agent as Record<string, unknown>) || {}
    agent.home = p.datusHome
    const permissions = (agent.permissions as Record<string, unknown>) || {}
    permissions.profile = settings.permissionProfile
    agent.permissions = permissions
    const filesystem = (agent.filesystem as Record<string, unknown>) || {}
    filesystem.strict = true
    agent.filesystem = filesystem
    data.agent = agent
    writeFileSync(file, stringifyYaml(data, { lineWidth: 120 }), 'utf-8')
  }

  private spawnServer(python: string, workspace: string, port: number): void {
    const p = paths()
    const args = [
      '-m',
      'datus.api.main',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--config',
      p.configPath,
      '--source',
      'web',
      '--stream',
      '--output-dir',
      join(workspace, 'output')
    ]
    this.log(`spawning: ${python} ${args.join(' ')} (cwd=${workspace})`)
    const child = spawn(python, args, {
      cwd: workspace,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        DATUS_API_TOKEN: this.token,
        FASTEMBED_CACHE_PATH: p.fastembedCache,
        UV_CACHE_DIR: p.uvCache
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    const pipe = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line) this.log(`[${stream}] ${line}`)
      }
    }
    child.stdout?.on('data', pipe('stdout'))
    child.stderr?.on('data', pipe('stderr'))
    child.on('exit', (code, signal) => {
      this.log(`datus-api exited (code=${code} signal=${signal})`)
      if (this.stopping) return
      this.child = null
      this.baseUrl = null
      this.setStatus({ state: 'failed', error: `datus-api exited unexpectedly (code ${code ?? signal})` })
      this.scheduleRestart(python, workspace, port)
    })
  }

  private scheduleRestart(python: string, workspace: string, port: number): void {
    if (this.restartAttempts >= MAX_RESTARTS) {
      this.log(`giving up after ${this.restartAttempts} restart attempts`)
      return
    }
    this.restartAttempts += 1
    const delay = this.restartAttempts * 1_000
    this.log(`restarting datus-api in ${delay}ms (attempt ${this.restartAttempts}/${MAX_RESTARTS})`)
    setTimeout(() => {
      if (this.stopping) return
      this.baseUrl = `http://127.0.0.1:${port}`
      this.spawnServer(python, workspace, port)
      void this.waitForHealth()
        .then((version) => {
          this.restartAttempts = 0
          this.setStatus({ state: 'ready', baseUrl: this.baseUrl!, version })
        })
        .catch((error: unknown) => {
          this.log(`restart health check failed: ${error instanceof Error ? error.message : String(error)}`)
        })
    }, delay)
  }

  private async waitForHealth(): Promise<string> {
    const baseUrl = this.baseUrl!
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.stopping) throw new Error('startup cancelled')
      try {
        const response = await fetch(`${baseUrl}/health/live`, {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(1_500)
        })
        if (response.ok) {
          const body = (await response.json()) as { version?: string }
          this.log(`datus-api ready: ${body.version ?? 'unknown'}`)
          return body.version ?? 'unknown'
        }
      } catch {
        // not up yet
      }
      await sleep(HEALTH_INTERVAL_MS)
    }
    throw new Error(`datus-api did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`)
  }
}

export function findFreePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.unref()
    server.on('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolvePromise(port))
      } else {
        server.close(() => rejectPromise(new Error('Failed to allocate a local port')))
      }
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) return resolvePromise(true)
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise(true)
    })
  })
}
