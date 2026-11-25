import { delimiter } from 'node:path'

import { describe, expect, it } from 'vitest'

import { prependPathDir } from '../../src/main/sidecar/pathEnv'

describe('prependPathDir', () => {
  it('prepends the bundled executable directory to PATH', () => {
    const env = prependPathDir({ PATH: ['/usr/bin', '/bin'].join(delimiter) }, '/app/resources/uv')
    expect(env.PATH).toBe(['/app/resources/uv', '/usr/bin', '/bin'].join(delimiter))
  })

  it('creates PATH when it is missing', () => {
    expect(prependPathDir({}, '/app/resources/uv').PATH).toBe('/app/resources/uv')
  })

  it('does not mutate the input environment', () => {
    const original = { PATH: '/usr/bin', OTHER: 'keep' }
    prependPathDir(original, '/app/resources/uv')
    expect(original.PATH).toBe('/usr/bin')
  })
})
