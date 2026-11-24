import { spawn } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const forward = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString()
      for (const line of text.split(/\r?\n/)) {
        if (line) options.onLine?.(line, stream)
      }
    }
    child.stdout?.on('data', forward('stdout'))
    child.stderr?.on('data', forward('stderr'))
    child.on('error', (error) => rejectPromise(error))
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

export function runCapture(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      options.onLine?.(text.trim(), 'stdout')
    })
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      options.onLine?.(text.trim(), 'stderr')
    })
    child.on('error', (error) => rejectPromise(error))
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout.trim())
      else rejectPromise(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim() || `exit ${code}`}`))
    })
  })
}
