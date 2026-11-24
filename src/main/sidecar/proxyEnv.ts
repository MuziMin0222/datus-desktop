const NO_PROXY_KEYS = ['NO_PROXY', 'no_proxy'] as const

/**
 * Normalise NO_PROXY for Python HTTP clients.
 *
 * httpx parses every NO_PROXY entry as a URL pattern; a bracketed IPv6 entry
 * such as ``[::1]`` makes it read the port as ``:1]`` and raise
 * ``InvalidURL`` while the client is still being constructed. That breaks
 * every LLM call before a request is even attempted. Bare ``::1`` is accepted,
 * so strip the brackets.
 */
export function sanitizeProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  for (const key of NO_PROXY_KEYS) {
    const raw = next[key]
    if (!raw) continue
    next[key] = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (entry.startsWith('[') && entry.endsWith(']') ? entry.slice(1, -1) : entry))
      .join(',')
  }
  return next
}
