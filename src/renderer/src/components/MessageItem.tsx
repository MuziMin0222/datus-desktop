import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import type { ChatMessage, InteractionRequest } from '@shared/chat'
import { apiGet } from '../api/client'
import type { ToolResultView } from '../state/chatReducer'

interface Props {
  message: ChatMessage
  toolResults: Map<string, ToolResultView>
  answered: Set<string>
  onInteraction: (key: string, input: string[][]) => void
  baseUrl: string
}

export function MessageItem({ message, toolResults, answered, onInteraction, baseUrl }: Props) {
  const isUser = message.role === 'user'
  const indent = Math.min(message.depth, 3) * 16
  return (
    <div style={{ marginLeft: indent }} className={message.depth > 0 ? 'border-l border-[var(--border)] pl-3' : ''}>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {isUser ? 'You' : message.depth > 0 ? `Sub-agent · ${message.role}` : 'Agent'}
      </div>
      <div className={isUser ? 'panel px-3 py-2' : 'space-y-2'}>
        {message.blocks.map((block, index) => {
          const payload = block.payload
          if (block.kind === 'markdown') {
            return (
              <div className="markdown" key={index}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {String(payload.content ?? '')}
                </ReactMarkdown>
              </div>
            )
          }
          if (block.kind === 'code') {
            return (
              <pre
                key={index}
                className="overflow-auto rounded-lg border border-[var(--border)] bg-black/40 p-3 text-xs"
              >
                <code>{String(payload.content ?? '')}</code>
              </pre>
            )
          }
          if (block.kind === 'thinking') {
            return (
              <details key={index} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs">
                <summary className="cursor-pointer text-[var(--muted)]">Thinking</summary>
                <div className="mt-2 whitespace-pre-wrap text-[var(--muted)]">{String(payload.content ?? '')}</div>
              </details>
            )
          }
          if (block.kind === 'call-tool') {
            const callToolId = String(payload.callToolId ?? '')
            return (
              <ToolCard
                key={index}
                name={String(payload.toolName ?? 'tool')}
                params={payload.toolParams as Record<string, unknown> | undefined}
                proxied={Boolean(payload.proxied)}
                result={toolResults.get(callToolId)}
              />
            )
          }
          if (block.kind === 'user-interaction') {
            const key = String(payload.interactionKey ?? '')
            const requests = (payload.requests as InteractionRequest[]) ?? []
            return (
              <InteractionCard
                key={index}
                interactionKey={key}
                requests={requests}
                answered={answered.has(key)}
                onSubmit={onInteraction}
              />
            )
          }
          if (block.kind === 'artifact') {
            return <ArtifactCard key={index} payload={payload} baseUrl={baseUrl} />
          }
          if (block.kind === 'error') {
            return (
              <div
                key={index}
                className="rounded-lg border border-red-900/60 bg-red-950/30 p-2 text-xs text-[var(--danger)]"
              >
                {String(payload.content ?? 'Agent error')}
              </div>
            )
          }
          if (block.kind === 'subagent-complete') {
            const error = payload.error ? ` · ${String(payload.error)}` : ''
            return (
              <div key={index} className="text-[11px] text-[var(--muted)]">
                Sub-agent {String(payload.subagentType ?? '')} finished · {String(payload.toolCount ?? 0)} tool calls
                {error}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

function ToolCard({
  name,
  params,
  proxied,
  result
}: {
  name: string
  params?: Record<string, unknown>
  proxied: boolean
  result?: ToolResultView
}) {
  const pending = !result
  const failed = result?.error
  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs">
      <summary className="flex cursor-pointer items-center gap-2">
        <span className={failed ? 'text-[var(--danger)]' : pending ? 'text-amber-400' : 'text-emerald-400'}>●</span>
        <span className="font-medium">{name}</span>
        {proxied && <span className="rounded bg-[#223447] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">client</span>}
        {result?.duration !== undefined && <span className="text-[var(--muted)]">{result.duration.toFixed(2)}s</span>}
        {pending && <span className="text-[var(--muted)]">running…</span>}
      </summary>
      {params && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/40 p-2 text-[11px] text-[var(--muted)]">
          {JSON.stringify(params, null, 2)}
        </pre>
      )}
      {result?.shortDesc && <div className="mt-1 text-[var(--muted)]">{result.shortDesc}</div>}
      {result?.error && <div className="mt-1 text-[var(--danger)]">{result.error}</div>}
      {result?.result !== undefined && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-black/40 p-2 text-[11px]">
          {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
        </pre>
      )}
    </details>
  )
}

function InteractionCard({
  interactionKey,
  requests,
  answered,
  onSubmit
}: {
  interactionKey: string
  requests: InteractionRequest[]
  answered: boolean
  onSubmit: (key: string, input: string[][]) => void
}) {
  const [selections, setSelections] = useState<string[][]>(() => requests.map(() => []))
  const [freeText, setFreeText] = useState<string[]>(() => requests.map(() => ''))

  function toggle(requestIndex: number, key: string, multi: boolean): void {
    setSelections((previous) => {
      const next = previous.map((item) => item.slice())
      const current = next[requestIndex]
      if (multi) {
        const position = current.indexOf(key)
        if (position >= 0) current.splice(position, 1)
        else current.push(key)
      } else {
        next[requestIndex] = [key]
      }
      return next
    })
  }

  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3">
      {requests.map((request, index) => (
        <div key={index} className="mb-3 last:mb-0">
          <div className="text-sm font-medium">{request.title}</div>
          {request.content && <div className="whitespace-pre-wrap text-xs text-[var(--muted)]">{request.content}</div>}
          {request.options && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(request.options).map(([key, label]) => {
                const active = selections[index]?.includes(key)
                return (
                  <button
                    key={key}
                    className={`btn ${active ? 'btn-primary' : ''}`}
                    onClick={() => toggle(index, key, Boolean(request.multiSelect))}
                    disabled={answered}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
          {request.allowFreeText && (
            <input
              className="input mt-2"
              placeholder="Type an answer…"
              value={freeText[index] ?? ''}
              onChange={(event) =>
                setFreeText((previous) =>
                  previous.map((item, position) => (position === index ? event.target.value : item))
                )
              }
              disabled={answered}
            />
          )}
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <button
          className="btn btn-primary"
          disabled={answered}
          onClick={() => {
            const input = requests.map((_request, index) => {
              const manual = freeText[index]?.trim()
              if (manual) return [manual]
              return selections[index] ?? []
            })
            onSubmit(interactionKey, input)
          }}
        >
          Submit
        </button>
        {answered && <span className="text-xs text-emerald-400">Answered</span>}
      </div>
    </div>
  )
}

function ArtifactCard({ payload, baseUrl }: { payload: Record<string, unknown>; baseUrl: string }) {
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kind = String(payload.kind ?? 'report')
  const slug = String(payload.slug ?? '')

  async function load(): Promise<void> {
    setError(null)
    try {
      const data = await apiGet<unknown>(baseUrl, `/api/v1/${kind}/detail?slug=${encodeURIComponent(slug)}`)
      setDetail(JSON.stringify(data, null, 2))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs">
      <div className="text-sm font-medium">{String(payload.name ?? slug)}</div>
      <div className="text-[var(--muted)]">
        {kind} · {slug}
        {payload.description ? ` · ${String(payload.description)}` : ''}
      </div>
      <button className="btn mt-2" onClick={load}>
        Fetch artifact detail
      </button>
      {error && <div className="mt-2 text-[var(--danger)]">{error}</div>}
      {detail && <pre className="mt-2 max-h-60 overflow-auto rounded bg-black/40 p-2 text-[11px]">{detail}</pre>}
    </div>
  )
}
