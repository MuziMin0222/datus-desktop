import { app, session, shell, type BrowserWindow } from 'electron'

export interface AuthTarget {
  baseUrl: string
  token?: string
  userId?: string
}

export function installAuthHeaderInjection(getTarget: () => AuthTarget | null): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const target = getTarget()
    if (target?.baseUrl && details.url.startsWith(target.baseUrl)) {
      if (target.token) details.requestHeaders['Authorization'] = `Bearer ${target.token}`
      if (target.userId) details.requestHeaders['X-Datus-User-Id'] = target.userId
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

export function installNavigationPolicy(window: BrowserWindow): void {
  const devOrigin = process.env.ELECTRON_RENDERER_URL
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://') || (devOrigin ? url.startsWith(devOrigin) : false)
    if (!allowed) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

export function installInsecureTlsPolicy(getConfig: () => { host: string; allow: boolean } | null): void {
  app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
    const config = getConfig()
    try {
      const host = new URL(url).host
      if (config?.allow && config.host && host === config.host) {
        event.preventDefault()
        callback(true)
        return
      }
    } catch {
      // fall through to the default rejection
    }
    callback(false)
  })
}
