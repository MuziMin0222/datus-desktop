export interface ArtifactFileEntry {
  path: string
  content: string
}

export interface ArtifactPayload {
  slug: string
  title: string
  created_at?: string | null
  files: ArtifactFileEntry[]
}

export type ArtifactKind = 'report' | 'dashboard'

export interface ArtifactHtmlOptions {
  kind: ArtifactKind
  /** Base URL that serves index.umd.js / index.css. */
  assetBase: string
  /** Live-query endpoint for dashboards. */
  queryEndpoint?: string
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeForScriptTag(json: string): string {
  return json.replace(/<\//g, '<\\/')
}

export function buildArtifactHtml(payload: ArtifactPayload, options: ArtifactHtmlOptions): string {
  const { kind, assetBase, queryEndpoint } = options
  const dataId = `datus-${kind}-data`
  const init =
    kind === 'dashboard'
      ? `window.DatusArtifact.initDashboard({rootId:'root',dataScriptId:'${dataId}',queryEndpoint:${JSON.stringify(
          queryEndpoint ?? ''
        )}})`
      : `window.DatusArtifact.initReport({rootId:'root',dataScriptId:'${dataId}'})`
  const data = escapeForScriptTag(
    JSON.stringify({
      slug: payload.slug,
      title: payload.title,
      created_at: payload.created_at ?? null,
      files: payload.files
    })
  )

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' datus-artifact: https://unpkg.com; style-src 'unsafe-inline' datus-artifact: https://unpkg.com; img-src data: blob: https:; font-src data: https:; connect-src http: https: data: blob:; worker-src blob:; frame-src 'self' data: blob:;" />
<title>${escapeHtml(payload.title || payload.slug)}</title>
<link rel="stylesheet" href="${escapeHtml(assetBase)}/index.css" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #ffffff; color: #404040; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  #root { height: 100%; overflow: auto; }
  .datus-fallback { display: grid; place-items: center; height: 100%; font-size: 13px; color: #808080; }
  .datus-error { max-width: 720px; margin: 40px auto; padding: 20px 24px; border: 1px solid #e05252; border-radius: 10px; background: rgba(224,82,82,0.06); font-size: 13px; line-height: 1.6; }
  .datus-error pre { max-height: 320px; overflow: auto; background: #f7f7f7; padding: 10px; border-radius: 6px; }
  @media (prefers-color-scheme: dark) {
    html, body { background: #222222; color: #d6d6d6; }
    .datus-error pre { background: #1e1e1e; }
  }
</style>
</head>
<body>
<div id="root"><div class="datus-fallback">Loading ${kind}…</div></div>
<div id="datus-error" class="datus-error" hidden>
  <strong>Could not render this ${kind}.</strong>
  <p>The viewer bundle failed to load or the artifact could not be initialized.</p>
  <pre id="datus-error-detail"></pre>
</div>
<script type="application/json" id="${dataId}">${data}</script>
<script>
  window.__datusShowError = function (detail) {
    var root = document.getElementById('root');
    var error = document.getElementById('datus-error');
    if (root) root.style.display = 'none';
    if (error) error.hidden = false;
    var pre = document.getElementById('datus-error-detail');
    if (pre && detail) pre.textContent = String(detail);
  };
  window.addEventListener('error', function (event) {
    window.__datusShowError && window.__datusShowError(event.message);
  });
</script>
<script src="${escapeHtml(assetBase)}/index.umd.js" onerror="window.__datusShowError('viewer bundle failed to load')"></script>
<script>
  (function () {
    try {
      if (!window.DatusArtifact) throw new Error('DatusArtifact global missing');
      ${init};
    } catch (error) {
      window.__datusShowError(error && error.message ? error.message : error);
    }
  })();
</script>
</body>
</html>`
}

export function payloadFromDetail(slug: string, detail: Record<string, unknown>): ArtifactPayload {
  const files = Array.isArray(detail.files)
    ? (detail.files as { path?: unknown; content?: unknown }[]).map((file) => ({
        path: String(file.path ?? ''),
        content: String(file.content ?? '')
      }))
    : []
  const manifest = (detail.manifest as Record<string, unknown> | undefined) ?? {}
  return {
    slug: typeof detail.slug === 'string' && detail.slug ? detail.slug : slug,
    title:
      (typeof detail.name === 'string' && detail.name) || (typeof manifest.name === 'string' && manifest.name) || slug,
    created_at: typeof detail.created_at === 'string' ? detail.created_at : null,
    files
  }
}

export function buildArtifactErrorHtml(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Artifact unavailable</title>
<style>
  body { margin: 0; display: grid; place-items: center; height: 100vh; background: #1b1f24; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .box { max-width: 640px; padding: 20px 24px; border: 1px solid #f87171; border-radius: 10px; background: rgba(248,113,113,0.08); font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
</style></head>
<body><div class="box">${escapeHtml(message)}</div></body></html>`
}
