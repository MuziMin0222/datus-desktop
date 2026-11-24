import type {
  ChatMessage,
  MessageBlock,
  SSEErrorData,
  SSEMessageData,
  SSEMessagePayload,
  SSESessionData,
  SSEUsageData
} from '@shared/chat'
import type { DecodedFrame } from '../api/sse'

export interface ChatState {
  messages: ChatMessage[]
  sessionId: string | null
  runId: string | null
  streaming: boolean
  usage: SSEUsageData | null
  error: string | null
  lastEventId: number | null
}

export const initialChatState: ChatState = {
  messages: [],
  sessionId: null,
  runId: null,
  streaming: false,
  usage: null,
  error: null,
  lastEventId: null
}

export type ChatAction =
  | { type: 'reset' }
  | { type: 'send' }
  | { type: 'abort' }
  | { type: 'fail'; message: string }
  | { type: 'user'; message: ChatMessage }
  | { type: 'history'; messages: ChatMessage[]; sessionId: string }
  | { type: 'sse'; frame: DecodedFrame }

export function messageFromPayload(payload: SSEMessagePayload): ChatMessage {
  return {
    id: payload.message_id,
    role: payload.role,
    depth: payload.depth ?? 0,
    parentActionId: payload.parent_action_id ?? null,
    blocks: (payload.content || []).map((item) => ({ kind: item.type, payload: item.payload || {} }))
  }
}

export function messagesFromHistory(payloads: SSEMessagePayload[]): ChatMessage[] {
  return payloads.map(messageFromPayload)
}

function upsert(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id)
  if (index === -1) return [...messages, message]
  const next = messages.slice()
  next[index] = message
  return next
}

function coalesce(blocks: MessageBlock[], incoming: MessageBlock[]): MessageBlock[] {
  const next = blocks.slice()
  for (const block of incoming) {
    const last = next[next.length - 1]
    if (last && last.kind === block.kind && (block.kind === 'markdown' || block.kind === 'code')) {
      const previous = String(last.payload.content ?? '')
      const addition = String(block.payload.content ?? '')
      next[next.length - 1] = { ...last, payload: { ...last.payload, content: previous + addition } }
    } else {
      next.push(block)
    }
  }
  return next
}

function applyMessageOp(
  messages: ChatMessage[],
  op: SSEMessageData['type'],
  payload: SSEMessagePayload
): ChatMessage[] {
  const incoming = messageFromPayload(payload)
  if (op === 'createMessage' || op === 'updateMessage') return upsert(messages, incoming)
  const index = messages.findIndex((candidate) => candidate.id === incoming.id)
  if (index === -1) return [...messages, incoming]
  const next = messages.slice()
  const current = next[index]
  next[index] = { ...current, blocks: coalesce(current.blocks, incoming.blocks) }
  return next
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'reset':
      return { ...initialChatState }
    case 'send':
      return { ...state, streaming: true, error: null }
    case 'abort':
      return { ...state, streaming: false }
    case 'fail':
      return { ...state, streaming: false, error: action.message }
    case 'user':
      return { ...state, messages: [...state.messages, action.message] }
    case 'history':
      return { ...state, messages: action.messages, sessionId: action.sessionId, streaming: false, error: null }
    case 'sse': {
      const frame = action.frame
      const lastEventId = frame.id !== undefined ? frame.id : state.lastEventId
      if (frame.event === 'session') {
        const data = frame.data as SSESessionData
        return { ...state, sessionId: data.session_id, runId: data.run_id ?? null, lastEventId }
      }
      if (frame.event === 'message') {
        const data = frame.data as SSEMessageData
        return { ...state, messages: applyMessageOp(state.messages, data.type, data.payload), lastEventId }
      }
      if (frame.event === 'usage') {
        return { ...state, usage: frame.data as SSEUsageData, lastEventId }
      }
      if (frame.event === 'end') {
        return { ...state, streaming: false, lastEventId }
      }
      if (frame.event === 'error') {
        const data = frame.data as SSEErrorData
        return { ...state, streaming: false, error: data.error || 'The agent reported an error', lastEventId }
      }
      return { ...state, lastEventId }
    }
    default:
      return state
  }
}

export interface ToolResultView {
  callToolId: string
  toolName?: string
  duration?: number
  shortDesc?: string
  result?: unknown
  error?: string
}

export function collectToolResults(messages: ChatMessage[]): Map<string, ToolResultView> {
  const results = new Map<string, ToolResultView>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'call-tool-result') continue
      const payload = block.payload as Record<string, unknown>
      const callToolId = String(payload.callToolId ?? '')
      if (!callToolId) continue
      results.set(callToolId, {
        callToolId,
        toolName: payload.toolName as string | undefined,
        duration: payload.duration as number | undefined,
        shortDesc: payload.shortDesc as string | undefined,
        result: payload.result,
        error: payload.error as string | undefined
      })
    }
  }
  return results
}
