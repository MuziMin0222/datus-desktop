import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type { ChatSessionItem, ChatSessionList, SSEMessagePayload } from '@shared/chat'
import type { BootstrapSnapshot, PermissionProfile } from '@shared/ipc'
import { apiGet, apiPost } from '../api/client'
import { decodeFrame, resumeChat, streamChat, type DecodedFrame } from '../api/sse'
import { chatReducer, collectToolResults, initialChatState, messagesFromHistory } from '../state/chatReducer'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { SettingsPanel } from './SettingsPanel'

const SUBAGENTS = [
  { id: 'chat', label: 'Chat' },
  { id: 'gen_sql', label: 'Gen SQL' },
  { id: 'ask_metrics', label: 'Ask Metrics' },
  { id: 'semantic_modeling', label: 'Semantic Modeling' },
  { id: 'gen_visual_report', label: 'Visual Report' },
  { id: 'gen_visual_dashboard', label: 'Visual Dashboard' },
  { id: 'gen_table', label: 'Gen Table' },
  { id: 'gen_job', label: 'Gen Job' }
]

const PROFILES: PermissionProfile[] = ['normal', 'auto', 'dangerous']

interface Props {
  snapshot: BootstrapSnapshot
  onRefresh: () => Promise<void>
  onReconfigure: () => void
}

export function ChatView({ snapshot, onRefresh, onReconfigure }: Props) {
  const baseUrl = snapshot.connection.baseUrl as string
  const source = snapshot.settings.mode === 'local' ? 'web' : 'desktop'
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const stateRef = useRef(state)
  stateRef.current = state
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const handledProxy = useRef(new Set<string>())

  const [sessions, setSessions] = useState<ChatSessionItem[]>([])
  const [subagent, setSubagent] = useState('chat')
  const [profile, setProfile] = useState<PermissionProfile>(snapshot.settings.permissionProfile)
  const [answered, setAnswered] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)

  const loadSessions = useCallback(
    async (agent: string) => {
      try {
        const data = await apiGet<ChatSessionList>(
          baseUrl,
          `/api/v1/chat/sessions?limit=50&subagent_id=${encodeURIComponent(agent)}`
        )
        setSessions(data.sessions ?? [])
      } catch {
        setSessions([])
      }
    },
    [baseUrl]
  )

  useEffect(() => {
    void loadSessions(subagent)
  }, [loadSessions, subagent])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length, state.streaming])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    for (const message of state.messages) {
      for (const block of message.blocks) {
        if (block.kind !== 'call-tool') continue
        const payload = block.payload as Record<string, unknown>
        if (!payload.proxied) continue
        const callToolId = String(payload.callToolId ?? '')
        if (!callToolId || handledProxy.current.has(callToolId)) continue
        handledProxy.current.add(callToolId)
        void (async () => {
          const result = await window.datus.executeProxiedTool({
            sessionId: stateRef.current.sessionId ?? '',
            callToolId,
            toolName: String(payload.toolName ?? ''),
            params: (payload.toolParams as Record<string, unknown>) ?? {}
          })
          const sessionId = stateRef.current.sessionId
          if (!sessionId) return
          await apiPost(baseUrl, '/api/v1/chat/tool_result', {
            session_id: sessionId,
            call_tool_id: callToolId,
            tool_result: result
          }).catch((cause: unknown) => {
            dispatch({ type: 'fail', message: cause instanceof Error ? cause.message : String(cause) })
          })
        })()
      }
    }
  }, [state.messages, baseUrl])

  function newChat(): void {
    abortRef.current?.abort()
    handledProxy.current.clear()
    dispatch({ type: 'reset' })
    setAnswered(new Set())
  }

  async function openSession(session: ChatSessionItem): Promise<void> {
    abortRef.current?.abort()
    handledProxy.current.clear()
    setAnswered(new Set())
    try {
      const data = await apiGet<{ messages: SSEMessagePayload[] }>(
        baseUrl,
        `/api/v1/chat/history?session_id=${encodeURIComponent(session.session_id)}`
      )
      dispatch({ type: 'history', messages: messagesFromHistory(data.messages ?? []), sessionId: session.session_id })
    } catch (cause) {
      dispatch({ type: 'fail', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  async function deleteSession(sessionId: string): Promise<void> {
    if (!window.confirm('Delete this session?')) return
    try {
      await fetch(`${baseUrl}/api/v1/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
      if (stateRef.current.sessionId === sessionId) newChat()
      void loadSessions(subagent)
    } catch {
      // surfaced on the next list refresh
    }
  }

  async function runStream(body: Record<string, unknown>): Promise<void> {
    const controller = new AbortController()
    abortRef.current = controller
    const onFrame = (frame: DecodedFrame): void => dispatch({ type: 'sse', frame })
    try {
      await streamChat(baseUrl, body, { signal: controller.signal, onFrame: (frame) => onFrame(decodeFrame(frame)) })
    } catch (cause) {
      if (controller.signal.aborted) {
        dispatch({ type: 'abort' })
        return
      }
      const sessionId = stateRef.current.sessionId
      const cursor = stateRef.current.lastEventId
      if (sessionId && cursor !== null) {
        try {
          await resumeChat(baseUrl, sessionId, cursor, {
            signal: controller.signal,
            onFrame: (frame) => onFrame(decodeFrame(frame))
          })
          return
        } catch {
          // fall through to the failure banner
        }
      }
      dispatch({ type: 'fail', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      abortRef.current = null
      void loadSessions(subagent)
    }
  }

  function send(text: string): void {
    dispatch({ type: 'send' })
    dispatch({
      type: 'user',
      message: {
        id: `local-${Date.now()}`,
        role: 'user',
        depth: 0,
        parentActionId: null,
        blocks: [{ kind: 'markdown', payload: { content: text } }]
      }
    })
    void runStream({
      message: text,
      session_id: stateRef.current.sessionId ?? undefined,
      source,
      subagent_id: subagent === 'chat' ? undefined : subagent,
      permission_mode: profile,
      stream_response: true
    })
  }

  async function stop(): Promise<void> {
    const sessionId = stateRef.current.sessionId
    abortRef.current?.abort()
    dispatch({ type: 'abort' })
    if (sessionId) {
      await apiPost(baseUrl, '/api/v1/chat/stop', { session_id: sessionId }).catch(() => undefined)
    }
  }

  async function insert(text: string): Promise<void> {
    const sessionId = stateRef.current.sessionId
    if (!sessionId) return
    dispatch({
      type: 'user',
      message: {
        id: `local-${Date.now()}`,
        role: 'user',
        depth: 0,
        parentActionId: null,
        blocks: [{ kind: 'markdown', payload: { content: text } }]
      }
    })
    await apiPost(baseUrl, '/api/v1/chat/insert', { session_id: sessionId, message: text }).catch((cause: unknown) => {
      dispatch({ type: 'fail', message: cause instanceof Error ? cause.message : String(cause) })
    })
  }

  async function changeProfile(next: PermissionProfile): Promise<void> {
    setProfile(next)
    void window.datus.setPermissionProfile(next)
    const { sessionId, runId, streaming } = stateRef.current
    if (streaming && sessionId && runId) {
      await apiPost(baseUrl, '/api/v1/chat/permission_mode', {
        session_id: sessionId,
        run_id: runId,
        permission_mode: next
      }).catch(() => undefined)
    }
  }

  async function submitInteraction(key: string, input: string[][]): Promise<void> {
    const sessionId = stateRef.current.sessionId
    if (!sessionId) return
    try {
      await apiPost(baseUrl, '/api/v1/chat/user_interaction', {
        session_id: sessionId,
        interaction_key: key,
        input
      })
      setAnswered((previous) => new Set(previous).add(key))
    } catch (cause) {
      dispatch({ type: 'fail', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const toolResults = collectToolResults(state.messages)

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel-2)]">
        <div className="px-4 py-4">
          <div className="text-sm font-semibold">Datus</div>
          <div className="text-[11px] text-[var(--muted)]">
            {snapshot.settings.mode} · {snapshot.connection.version ?? 'agent'}
          </div>
        </div>
        <div className="px-3">
          <button className="btn w-full" onClick={newChat}>
            + New chat
          </button>
        </div>
        <div className="mt-3 flex-1 overflow-auto px-2 pb-3">
          {sessions.map((session) => (
            <div
              key={session.session_id}
              className={`group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-xs hover:bg-[#16202b] ${
                state.sessionId === session.session_id ? 'bg-[#16202b]' : ''
              }`}
              onClick={() => void openSession(session)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{session.user_query || 'Untitled session'}</div>
                <div className="text-[10px] text-[var(--muted)]">
                  {session.total_turns} turns · {session.token_count} tokens
                </div>
              </div>
              <button
                className="invisible text-[var(--muted)] hover:text-[var(--danger)] group-hover:visible"
                onClick={(event) => {
                  event.stopPropagation()
                  void deleteSession(session.session_id)
                }}
              >
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 && <div className="px-2 py-4 text-xs text-[var(--muted)]">No sessions yet.</div>}
        </div>
        <div className="border-t border-[var(--border)] p-3">
          <button className="btn w-full" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <select className="input w-44" value={subagent} onChange={(event) => setSubagent(event.target.value)}>
            {SUBAGENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="input w-36"
            value={profile}
            onChange={(event) => void changeProfile(event.target.value as PermissionProfile)}
          >
            {PROFILES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <div className="ml-auto text-xs text-[var(--muted)]">
            {state.streaming ? 'streaming…' : state.sessionId ? `session ${state.sessionId.slice(0, 8)}` : 'new chat'}
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-auto p-5">
          {state.messages.length === 0 && (
            <div className="mt-20 text-center text-sm text-[var(--muted)]">
              Ask a question, explore your catalog, or pick a sub-agent above.
            </div>
          )}
          {state.messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              toolResults={toolResults}
              answered={answered}
              onInteraction={(key, input) => void submitInteraction(key, input)}
              baseUrl={baseUrl}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {state.error && (
          <div className="mx-4 mb-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-[var(--danger)]">
            {state.error}
          </div>
        )}

        <div className="p-4">
          <Composer
            streaming={state.streaming}
            onSend={send}
            onInsert={(text) => void insert(text)}
            onStop={() => void stop()}
          />
          {state.usage && (
            <div className="mt-1 px-1 text-[11px] text-[var(--muted)]">
              tokens {state.usage.session_total_tokens ?? state.usage.usage?.total_tokens ?? '—'}
              {state.usage.context_length ? ` · context ${state.usage.context_length}` : ''}
            </div>
          )}
        </div>
      </main>

      {showSettings && (
        <SettingsPanel
          snapshot={snapshot}
          onClose={() => setShowSettings(false)}
          onReconfigure={() => {
            setShowSettings(false)
            onReconfigure()
          }}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
