import { describe, expect, it } from 'vitest'

import { agentFromSessionId, chatAgent, parseSlashCommand } from '../../src/renderer/src/chatAgents'

describe('parseSlashCommand', () => {
  it('leaves ordinary messages on automatic routing', () => {
    expect(parseSlashCommand('How many schools are there?')).toEqual({
      agentId: null,
      message: 'How many schools are there?'
    })
  })

  it('resolves the friendly slash command', () => {
    expect(parseSlashCommand('/sql show daily revenue')).toEqual({
      agentId: 'gen_sql',
      command: '/sql',
      message: 'show daily revenue'
    })
  })

  it('accepts the backend agent id as a command alias', () => {
    expect(parseSlashCommand('/semantic_modeling add a revenue metric')).toEqual({
      agentId: 'semantic_modeling',
      command: '/semantic_modeling',
      message: 'add a revenue metric'
    })
  })

  it('rejects unknown commands', () => {
    expect(parseSlashCommand('/unknown do something').error).toContain('Unknown command')
  })

  it('rejects a command without a prompt', () => {
    expect(parseSlashCommand('/metrics').error).toBe('Enter a request after /metrics.')
  })
})

describe('agentFromSessionId', () => {
  it('reads the agent prefix from session ids', () => {
    expect(agentFromSessionId('gen_sql_session_abc123')).toBe('gen_sql')
    expect(agentFromSessionId('chat_session_abc123')).toBe('chat')
  })

  it('treats legacy ids as chat sessions', () => {
    expect(agentFromSessionId('legacy-session')).toBe('chat')
  })
})

describe('chatAgent', () => {
  it('falls back to the raw id for unknown custom agents', () => {
    expect(chatAgent('my_custom_agent').label).toBe('my_custom_agent')
  })
})
