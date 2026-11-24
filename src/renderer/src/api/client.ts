const DEFAULT_TIMEOUT_MS = 15_000

export interface ResultEnvelope<T> {
  success: boolean
  data: T | null
  errorCode?: string | null
  errorMessage?: string | null
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  })
  if (response.status === 401) throw new Error('Unauthorized: check the access token in Settings')
  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Invalid JSON from ${path}`)
    }
  }
  const envelope = parsed as ResultEnvelope<T> | null
  if (!envelope || typeof envelope !== 'object' || !('success' in envelope)) {
    return parsed as T
  }
  if (!envelope.success) {
    throw new Error(envelope.errorMessage || envelope.errorCode || `Request failed: ${path}`)
  }
  return envelope.data as T
}

export function apiGet<T>(baseUrl: string, path: string): Promise<T> {
  return request<T>(baseUrl, path)
}

export function apiPost<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return request<T>(baseUrl, path, { method: 'POST', body: JSON.stringify(body) })
}

export function apiPut<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return request<T>(baseUrl, path, { method: 'PUT', body: JSON.stringify(body) })
}
