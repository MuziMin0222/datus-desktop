import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ProxyToolExecutor } from '../../src/main/tools/proxyExecutor'

function setup(): { workspace: string; executor: ProxyToolExecutor } {
  const workspace = mkdtempSync(join(tmpdir(), 'datus-desktop-ws-'))
  return { workspace, executor: new ProxyToolExecutor(() => workspace) }
}

describe('ProxyToolExecutor', () => {
  it('writes a file inside the workspace', () => {
    const { workspace, executor } = setup()
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c1',
      toolName: 'write_file',
      params: { path: 'notes/hello.txt', content: 'hello' }
    })
    expect(result.success).toBe(1)
    expect(readFileSync(join(workspace, 'notes/hello.txt'), 'utf-8')).toBe('hello')
  })

  it('edits exactly one occurrence', () => {
    const { workspace, executor } = setup()
    writeFileSync(join(workspace, 'a.txt'), 'one two one')
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c2',
      toolName: 'edit_file',
      params: { path: 'a.txt', old_string: 'two', new_string: 'three' }
    })
    expect(result.success).toBe(1)
    expect(readFileSync(join(workspace, 'a.txt'), 'utf-8')).toBe('one three one')
  })

  it('rejects an ambiguous edit', () => {
    const { workspace, executor } = setup()
    writeFileSync(join(workspace, 'a.txt'), 'one two one')
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c3',
      toolName: 'edit_file',
      params: { path: 'a.txt', old_string: 'one', new_string: 'zero' }
    })
    expect(result.success).toBe(0)
    expect(result.error).toMatch(/more than once/)
  })

  it('rejects a missing old_string', () => {
    const { workspace, executor } = setup()
    writeFileSync(join(workspace, 'a.txt'), 'content')
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c4',
      toolName: 'edit_file',
      params: { path: 'a.txt', old_string: 'absent', new_string: 'x' }
    })
    expect(result.success).toBe(0)
    expect(result.error).toMatch(/not found/)
  })

  it('deletes a regular file only', () => {
    const { workspace, executor } = setup()
    writeFileSync(join(workspace, 'gone.txt'), 'x')
    mkdirSync(join(workspace, 'dir'))
    const fileResult = executor.execute({
      sessionId: 's',
      callToolId: 'c5',
      toolName: 'delete_file',
      params: { path: 'gone.txt' }
    })
    expect(fileResult.success).toBe(1)
    expect(existsSync(join(workspace, 'gone.txt'))).toBe(false)

    const dirResult = executor.execute({
      sessionId: 's',
      callToolId: 'c6',
      toolName: 'delete_file',
      params: { path: 'dir' }
    })
    expect(dirResult.success).toBe(0)
    expect(dirResult.error).toMatch(/non-file/)
  })

  it('rejects relative path escapes', () => {
    const { executor } = setup()
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c7',
      toolName: 'write_file',
      params: { path: '../outside.txt', content: 'nope' }
    })
    expect(result.success).toBe(0)
    expect(result.error).toMatch(/outside the workspace/)
  })

  it('rejects absolute paths outside the workspace', () => {
    const { executor } = setup()
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c8',
      toolName: 'write_file',
      params: { path: '/tmp/datus-desktop-outside.txt', content: 'nope' }
    })
    expect(result.success).toBe(0)
    expect(result.error).toMatch(/outside the workspace/)
  })

  it('rejects symlinks that point outside the workspace', () => {
    const { workspace, executor } = setup()
    const outside = mkdtempSync(join(tmpdir(), 'datus-desktop-outside-'))
    writeFileSync(join(outside, 'target.txt'), 'secret')
    symlinkSync(join(outside, 'target.txt'), join(workspace, 'link.txt'))
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c9',
      toolName: 'write_file',
      params: { path: 'link.txt', content: 'nope' }
    })
    expect(result.success).toBe(0)
    expect(result.error).toMatch(/symlink/)
  })

  it('rejects unknown tools', () => {
    const { executor } = setup()
    const result = executor.execute({
      sessionId: 's',
      callToolId: 'c10',
      toolName: 'execute_sql',
      params: {}
    })
    expect(result.success).toBe(0)
    expect(result.error).toMatch(/Unsupported/)
  })
})
