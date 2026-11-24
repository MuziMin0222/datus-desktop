import { describe, expect, it } from 'vitest'

import {
  buildArtifactErrorHtml,
  buildArtifactHtml,
  payloadFromDetail,
  type ArtifactPayload
} from '../../src/main/artifacts/html'

const payload: ArtifactPayload = {
  slug: 'demo_report',
  title: 'Demo <Report>',
  created_at: '2026-01-01T00:00:00Z',
  files: [{ path: 'render/app.jsx', content: 'export default () => <div>closing </script> tag</div>' }]
}

describe('buildArtifactHtml', () => {
  it('embeds the payload and report init call', () => {
    const html = buildArtifactHtml(payload, { kind: 'report', assetBase: 'datus-artifact://artifact/assets' })
    expect(html).toContain('id="datus-report-data"')
    expect(html).toContain('window.DatusArtifact.initReport')
    expect(html).toContain('datus-artifact://artifact/assets/index.umd.js')
    expect(html).toContain('datus-artifact://artifact/assets/index.css')
    expect(html).toContain('Demo &lt;Report&gt;')
  })

  it('escapes closing script tags inside file contents', () => {
    const html = buildArtifactHtml(payload, { kind: 'report', assetBase: 'https://cdn.example/dist' })
    expect(html).not.toContain('closing </script> tag')
    expect(html).toContain('closing <\\/script> tag')
  })

  it('passes the live query endpoint to dashboards', () => {
    const html = buildArtifactHtml(payload, {
      kind: 'dashboard',
      assetBase: 'datus-artifact://artifact/assets',
      queryEndpoint: 'http://127.0.0.1:1234/api/v1/dashboard/query'
    })
    expect(html).toContain('initDashboard')
    expect(html).toContain('queryEndpoint:"http://127.0.0.1:1234/api/v1/dashboard/query"')
  })

  it('restricts iframe CSP to the artifact scheme and backend network', () => {
    const html = buildArtifactHtml(payload, { kind: 'report', assetBase: 'datus-artifact://artifact/assets' })
    expect(html).toContain("script-src 'unsafe-inline' 'unsafe-eval' datus-artifact:")
    expect(html).toContain('connect-src http: https:')
  })
})

describe('payloadFromDetail', () => {
  it('maps the detail response onto the viewer payload', () => {
    const mapped = payloadFromDetail('fallback_slug', {
      slug: 'real_slug',
      name: 'Real Name',
      created_at: '2026-02-02T00:00:00Z',
      files: [{ path: 'render/app.jsx', content: 'x' }]
    })
    expect(mapped).toEqual({
      slug: 'real_slug',
      title: 'Real Name',
      created_at: '2026-02-02T00:00:00Z',
      files: [{ path: 'render/app.jsx', content: 'x' }]
    })
  })

  it('falls back to manifest name and slug', () => {
    const mapped = payloadFromDetail('slug_only', { manifest: { name: 'Manifest Name' }, files: [] })
    expect(mapped.title).toBe('Manifest Name')
    const missing = payloadFromDetail('slug_only', {})
    expect(missing.title).toBe('slug_only')
    expect(missing.files).toEqual([])
    expect(missing.created_at).toBeNull()
  })
})

describe('buildArtifactErrorHtml', () => {
  it('escapes the error message', () => {
    const html = buildArtifactErrorHtml('<script>alert(1)</script>')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})
