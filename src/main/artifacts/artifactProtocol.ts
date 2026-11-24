import { existsSync, readFileSync } from 'node:fs'
import { protocol } from 'electron'

import type { AuthTarget } from '../security'
import { resourcePath } from '../sidecar/paths'
import { buildArtifactErrorHtml, buildArtifactHtml, payloadFromDetail, type ArtifactKind } from './html'

export const ARTIFACT_SCHEME = 'datus-artifact'
const ARTIFACT_HOST = 'artifact'
const CDN_BASE = 'https://unpkg.com/@datus/web-artifact-render@~2.0.0/dist'
const SLUG_RE = /^[A-Za-z0-9_-]+$/

/** Must run before app.whenReady(). */
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARTIFACT_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

function assetDir(): string {
  return resourcePath('artifact-render')
}

function hasVendoredAssets(): boolean {
  return existsSync(`${assetDir()}/index.umd.js`) && existsSync(`${assetDir()}/index.css`)
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}

function assetResponse(pathname: string): Response {
  const name = pathname.replace(/^\/assets\//, '')
  if (name !== 'index.umd.js' && name !== 'index.css') {
    return new Response('Not found', { status: 404 })
  }
  const file = `${assetDir()}/${name}`
  if (!existsSync(file)) return new Response('Not found', { status: 404 })
  return new Response(readFileSync(file), {
    headers: {
      'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  })
}

async function fetchDetail(auth: AuthTarget, kind: ArtifactKind, slug: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {}
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`
  if (auth.userId) headers['X-Datus-User-Id'] = auth.userId
  const response = await fetch(`${auth.baseUrl}/api/v1/${kind}/detail?slug=${encodeURIComponent(slug)}`, {
    headers,
    signal: AbortSignal.timeout(15_000)
  })
  const body = (await response.json()) as {
    success?: boolean
    data?: Record<string, unknown>
    errorMessage?: string
  }
  if (!response.ok || !body?.success || !body.data) {
    throw new Error(body?.errorMessage || `artifact detail request failed with HTTP ${response.status}`)
  }
  return body.data
}

export function registerArtifactProtocol(getAuth: () => AuthTarget | null): void {
  protocol.handle(ARTIFACT_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== ARTIFACT_HOST) {
      return htmlResponse(buildArtifactErrorHtml('Unknown artifact host'), 404)
    }
    if (url.pathname.startsWith('/assets/')) {
      return assetResponse(url.pathname)
    }
    const match = /^\/(report|dashboard)\/([^/]+)\/?$/.exec(url.pathname)
    if (!match) {
      return htmlResponse(buildArtifactErrorHtml('Unknown artifact URL'), 404)
    }
    const kind = match[1] as ArtifactKind
    const slug = decodeURIComponent(match[2])
    if (!SLUG_RE.test(slug)) {
      return htmlResponse(buildArtifactErrorHtml(`Invalid ${kind} slug: ${slug}`), 400)
    }
    const auth = getAuth()
    if (!auth?.baseUrl) {
      return htmlResponse(buildArtifactErrorHtml('The Datus backend is not connected'), 503)
    }
    try {
      const detail = await fetchDetail(auth, kind, slug)
      const payload = payloadFromDetail(slug, detail)
      const assetBase = hasVendoredAssets() ? `${ARTIFACT_SCHEME}://${ARTIFACT_HOST}/assets` : CDN_BASE
      return htmlResponse(
        buildArtifactHtml(payload, {
          kind,
          assetBase,
          queryEndpoint: `${auth.baseUrl}/api/v1/dashboard/query`
        })
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      return htmlResponse(buildArtifactErrorHtml(`Could not load ${kind} "${slug}":\n${message}`), 502)
    }
  })
}
