import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '../../src/renderer/src/api/client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiGet', () => {
  it('preserves HTTP 503 status and FastAPI detail when the backend cannot read chat history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'history archive unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )

    await expect(apiGet('http://backend.test', '/api/v1/chat/history?session_id=s1')).rejects.toMatchObject({
      status: 503,
      message: 'history archive unavailable'
    })
  })

  it.each([400, 502])('preserves HTTP %i status for FastAPI errors without a result envelope', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: 'backend unavailable' }), {
          status,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    )

    await expect(apiGet('http://backend.test', '/api/v1/chat/sessions')).rejects.toMatchObject({
      status,
      message: 'backend unavailable'
    })
  })

  it('keeps the existing unauthorized message for HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))

    await expect(apiGet('http://backend.test', '/api/v1/chat/sessions')).rejects.toThrow(
      'Unauthorized: check the access token in Settings'
    )
  })
})
