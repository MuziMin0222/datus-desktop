import { describe, expect, it } from 'vitest'

import type { DecodedFrame } from '../../src/renderer/src/api/sse'
import {
  chatReducer,
  collectToolResults,
  initialChatState,
  messagesFromHistory,
  type ChatState
} from '../../src/renderer/src/state/chatReducer'

function messageFrame(
  op: 'createMessage' | 'appendMessage' | 'updateMessage',
  id: string,
  blocks: { type: string; payload: Record<string, unknown> }[],
  extra: Record<string, unknown> = {},
  eventId = 2
): DecodedFrame {
  return {
    id: eventId,
    event: 'message',
    data: { type: op, payload: { message_id: id, role: 'assistant', content: blocks, ...extra } }
  }
}

function apply(state: ChatState, ...frames: DecodedFrame[]): ChatState {
  return frames.reduce((current, frame) => chatReducer(current, { type: 'sse', frame }), state)
}

describe('chatReducer', () => {
  it('tracks session and run ids', () => {
    const state = chatReducer(initialChatState, {
      type: 'sse',
      frame: { id: 1, event: 'session', data: { session_id: 's1', run_id: 'r1' } }
    })
    expect(state.sessionId).toBe('s1')
    expect(state.runId).toBe('r1')
    expect(state.lastEventId).toBe(1)
  })

  it('creates, appends to and updates messages', () => {
    let state = apply(
      initialChatState,
      messageFrame('createMessage', 'm1', [{ type: 'markdown', payload: { content: 'Hello ' } }])
    )
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].blocks[0].payload.content).toBe('Hello ')

    state = apply(state, messageFrame('appendMessage', 'm1', [{ type: 'markdown', payload: { content: 'world' } }]))
    expect(state.messages[0].blocks).toHaveLength(1)
    expect(state.messages[0].blocks[0].payload.content).toBe('Hello world')

    state = apply(state, messageFrame('updateMessage', 'm1', [{ type: 'markdown', payload: { content: 'replaced' } }]))
    expect(state.messages[0].blocks).toHaveLength(1)
    expect(state.messages[0].blocks[0].payload.content).toBe('replaced')
  })

  it('appends non-text blocks without coalescing', () => {
    let state = apply(
      initialChatState,
      messageFrame('createMessage', 'm1', [{ type: 'thinking', payload: { content: 'a' } }])
    )
    state = apply(state, messageFrame('appendMessage', 'm1', [{ type: 'thinking', payload: { content: 'b' } }]))
    expect(state.messages[0].blocks).toHaveLength(2)
  })

  it('keeps sub-agent grouping metadata', () => {
    const state = apply(
      initialChatState,
      messageFrame('createMessage', 'm2', [{ type: 'markdown', payload: { content: 'nested' } }], {
        depth: 1,
        parent_action_id: 'parent'
      })
    )
    expect(state.messages[0].depth).toBe(1)
    expect(state.messages[0].parentActionId).toBe('parent')
  })

  it('ends the turn and records errors', () => {
    let state = chatReducer(initialChatState, { type: 'send' })
    expect(state.streaming).toBe(true)
    state = apply(state, { id: 9, event: 'end', data: { total_tokens: 10 } })
    expect(state.streaming).toBe(false)
    expect(state.lastEventId).toBe(9)

    const failed = apply(
      { ...initialChatState, streaming: true },
      { id: 10, event: 'error', data: { error: 'boom', error_type: 'runtime' } }
    )
    expect(failed.streaming).toBe(false)
    expect(failed.error).toBe('boom')
  })

  it('stores usage frames', () => {
    const state = apply(initialChatState, {
      id: 3,
      event: 'usage',
      data: { usage: { total_tokens: 42 }, session_total_tokens: 100, context_length: 2000 }
    })
    expect(state.usage?.session_total_tokens).toBe(100)
    expect(state.lastEventId).toBe(3)
  })
})

describe('history and tool results', () => {
  it('maps history payloads into messages', () => {
    const messages = messagesFromHistory([
      { message_id: 'u1', role: 'user', content: [{ type: 'markdown', payload: { content: 'hi' } }] },
      { message_id: 'a1', role: 'assistant', content: [{ type: 'markdown', payload: { content: 'hello' } }], depth: 0 }
    ])
    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(messages[1].blocks[0].kind).toBe('markdown')
  })

  it('collects call-tool results by call id', () => {
    const messages = messagesFromHistory([
      {
        message_id: 't1',
        role: 'tool',
        content: [
          {
            type: 'call-tool-result',
            payload: { callToolId: 'tc1', toolName: 'execute_sql', duration: 1.5, shortDesc: 'ok', result: { rows: 2 } }
          },
          { type: 'call-tool-result', payload: { callToolId: 'tc2', toolName: 'unknown' } }
        ]
      }
    ])
    const results = collectToolResults(messages)
    expect(results.get('tc1')?.toolName).toBe('execute_sql')
    expect(results.get('tc1')?.duration).toBe(1.5)
    expect(results.has('tc2')).toBe(true)
  })
})
