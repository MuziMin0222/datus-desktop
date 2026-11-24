import { randomBytes } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

import type { ProxiedToolRequest, ToolExecutionResult } from '@shared/ipc'

/**
 * Executes filesystem tools the server delegated to the desktop client.
 * Every path must resolve inside the configured workspace.
 */
export class ProxyToolExecutor {
  constructor(private readonly workspace: () => string | null) {}

  execute(request: ProxiedToolRequest): ToolExecutionResult {
    try {
      switch (request.toolName) {
        case 'write_file':
          return this.write(request.params)
        case 'edit_file':
          return this.edit(request.params)
        case 'delete_file':
          return this.remove(request.params)
        default:
          return { success: 0, error: `Unsupported proxied tool: ${request.toolName}` }
      }
    } catch (cause) {
      return { success: 0, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  private workspaceRoot(): string {
    const workspace = this.workspace()
    if (!workspace) throw new Error('No workspace is configured for the local backend')
    return resolve(workspace)
  }

  private resolveInside(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('A path is required')
    const root = this.workspaceRoot()
    // macOS resolves /tmp to /private/tmp; compare through realpath so a
    // symlinked workspace root is not mistaken for an escape.
    const realRoot = existsSync(root) ? realpathSync(root) : root
    const candidate = resolve(root, raw)
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      throw new Error(`Refusing to touch a path outside the workspace: ${raw}`)
    }
    // Resolve symlinked parents so a link cannot smuggle the write elsewhere.
    const parent = dirname(candidate)
    if (existsSync(parent)) {
      const realParent = realpathSync(parent)
      if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
        throw new Error(`Refusing to follow a symlink outside the workspace: ${raw}`)
      }
    }
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Refusing to follow a symlink: ${raw}`)
    }
    return candidate
  }

  private atomicWrite(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.tmp-${randomBytes(4).toString('hex')}`
    writeFileSync(temp, content, 'utf-8')
    renameSync(temp, path)
  }

  private write(params: Record<string, unknown>): ToolExecutionResult {
    const path = this.resolveInside(params.path)
    const content = typeof params.content === 'string' ? params.content : ''
    this.atomicWrite(path, content)
    return { success: 1, result: `Wrote ${content.length} characters to ${path}` }
  }

  private edit(params: Record<string, unknown>): ToolExecutionResult {
    const path = this.resolveInside(params.path)
    const oldString = typeof params.old_string === 'string' ? params.old_string : ''
    const newString = typeof params.new_string === 'string' ? params.new_string : ''
    if (!oldString) throw new Error('old_string must not be empty')
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)
    const text = readFileSync(path, 'utf-8')
    const first = text.indexOf(oldString)
    if (first === -1) throw new Error('old_string was not found in the file')
    if (text.indexOf(oldString, first + oldString.length) !== -1) {
      throw new Error('old_string matches more than once; include more context to disambiguate')
    }
    this.atomicWrite(path, text.slice(0, first) + newString + text.slice(first + oldString.length))
    return { success: 1, result: `Edited ${path}` }
  }

  private remove(params: Record<string, unknown>): ToolExecutionResult {
    const path = this.resolveInside(params.path)
    if (!existsSync(path)) throw new Error(`File not found: ${path}`)
    if (!lstatSync(path).isFile()) throw new Error(`Refusing to delete a non-file: ${path}`)
    unlinkSync(path)
    return { success: 1, result: `Deleted ${path}` }
  }
}
