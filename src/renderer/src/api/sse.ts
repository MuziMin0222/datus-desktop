export interface SSEFrame {
  id?: number
  event: string
  data: string
}

export interface DecodedFrame {
  id?: number
  event: string
  data: unknown
}

export function decodeFrame(frame: SSEFrame): DecodedFrame {
  if (!frame.data) return { id: frame.id, event: frame.event, data: null }
  try {
    return { id: frame.id, event: frame.event, data: JSON.parse(frame.data) }
  } catch {
    return { id: frame.id, event: frame.event, data: frame.data }
  }
}

/**
 * Incremental parser for text/event-stream frames.
 *
 * Handles CRLF, split UTF-8 chunks (callers decode with stream: true), comment
 * lines, multi-line ``data:`` payloads and frames without an id.
 */
export class SSEParser {
  private buffer = ''

  push(chunk: string): SSEFrame[] {
    this.buffer += chunk.replace(/\r\n/g, '\n')
    const frames: SSEFrame[] = []
    let boundary = this.buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const raw = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      const frame = parseFrame(raw)
      if (frame) frames.push(frame)
      boundary = this.buffer.indexOf('\n\n')
    }
    return frames
  }

  get pending(): string {
    return this.buffer
  }
}

function parseFrame(raw: string): SSEFrame | null {
  let id: number | undefined
  let event = 'message'
  const dataLines: string[] = []
  let sawField = false
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    sawField = true
    if (field === 'id') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed) && parsed >= 0) id = parsed
    } else if (field === 'event') {
      event = value || 'message'
    } else if (field === 'data') {
      dataLines.push(value)
    }
  }
  if (!sawField) return null
  return { id, event, data: dataLines.join('\n') }
}

export interface StreamOptions {
  onFrame: (frame: SSEFrame) => void
  signal?: AbortSignal
}

export interface StreamResult {
  lastEventId: number | null
}

async function readStream(response: Response, options: StreamOptions): Promise<StreamResult> {
  if (!response.body) throw new Error('The server returned no response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SSEParser()
  let lastEventId: number | null = null
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
        if (frame.id !== undefined && frame.id >= 0) lastEventId = frame.id
        options.onFrame(frame)
        if (frame.event === 'end' || frame.event === 'error') return { lastEventId }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return { lastEventId }
}

async function postStream(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  options: StreamOptions
): Promise<StreamResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: options.signal
  })
  if (response.status === 401) throw new Error('Unauthorized: check the access token in Settings')
  if (!response.ok) throw new Error(`Chat request failed with HTTP ${response.status}`)
  return readStream(response, options)
}

export function streamChat(
  baseUrl: string,
  body: Record<string, unknown>,
  options: StreamOptions
): Promise<StreamResult> {
  return postStream(baseUrl, '/api/v1/chat/stream', body, options)
}

export function resumeChat(
  baseUrl: string,
  sessionId: string,
  fromEventId: number | null,
  options: StreamOptions
): Promise<StreamResult> {
  return postStream(
    baseUrl,
    '/api/v1/chat/resume',
    { session_id: sessionId, from_event_id: fromEventId ?? undefined },
    options
  )
}
