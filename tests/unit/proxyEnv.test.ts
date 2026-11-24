import { describe, expect, it } from 'vitest'

import { sanitizeProxyEnv } from '../../src/main/sidecar/proxyEnv'

describe('sanitizeProxyEnv', () => {
  it('converts bracketed IPv6 entries to bare addresses', () => {
    const env = sanitizeProxyEnv({
      NO_PROXY: 'localhost,127.0.0.1,[::1],::1',
      no_proxy: '[fe80::1]'
    })
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1,::1,::1')
    expect(env.no_proxy).toBe('fe80::1')
  })

  it('trims whitespace and drops empty entries', () => {
    const env = sanitizeProxyEnv({ NO_PROXY: ' localhost , ,127.0.0.1 ' })
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1')
  })

  it('leaves other variables untouched', () => {
    const env = sanitizeProxyEnv({ HTTP_PROXY: 'http://proxy:8080', PATH: '/usr/bin' })
    expect(env.HTTP_PROXY).toBe('http://proxy:8080')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.NO_PROXY).toBeUndefined()
  })

  it('does not mutate the input environment', () => {
    const original = { NO_PROXY: '[::1]' }
    sanitizeProxyEnv(original)
    expect(original.NO_PROXY).toBe('[::1]')
  })
})
