const DEFAULT_TIMEOUT_MS = 15_000

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

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
  if (response.status === 401) throw new ApiError('Unauthorized: check the access token in Settings', response.status)
  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      if (!response.ok) throw new ApiError(`Request failed: ${path}`, response.status)
      throw new Error(`Invalid JSON from ${path}`)
    }
  }
  if (!response.ok) {
    const error = parsed as { detail?: unknown; errorMessage?: unknown; errorCode?: unknown } | null
    const message =
      (typeof error?.detail === 'string' && error.detail) ||
      (typeof error?.errorMessage === 'string' && error.errorMessage) ||
      (typeof error?.errorCode === 'string' && error.errorCode) ||
      `Request failed: ${path}`
    throw new ApiError(message, response.status)
  }
  const envelope = parsed as ResultEnvelope<T> | null
  if (!envelope || typeof envelope !== 'object' || !('success' in envelope)) {
    return parsed as T
  }
  if (!envelope.success) {
    throw new ApiError(envelope.errorMessage || envelope.errorCode || `Request failed: ${path}`, response.status)
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
