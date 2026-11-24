import { app } from 'electron'
import { autoUpdater, type UpdateInfo } from 'electron-updater'

import type { UpdateStatus } from '@shared/ipc'

type Listener = (status: UpdateStatus) => void

let status: UpdateStatus = { state: 'idle' }
const listeners = new Set<Listener>()

function publish(next: UpdateStatus): void {
  status = next
  for (const listener of listeners) listener(next)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function onUpdateStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function updatesSupported(): boolean {
  return app.isPackaged && process.env.DATUS_DESKTOP_DISABLE_UPDATES !== '1'
}

export function initAutoUpdater(): void {
  if (!updatesSupported()) {
    publish({
      state: 'disabled',
      message: app.isPackaged
        ? 'Updates disabled by DATUS_DESKTOP_DISABLE_UPDATES'
        : 'Development builds do not auto-update'
    })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) => publish({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => publish({ state: 'up-to-date', version: app.getVersion() }))
  autoUpdater.on('download-progress', (progress) =>
    publish({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    publish({ state: 'downloaded', version: info.version, message: 'Restart to install' })
  )
  autoUpdater.on('error', (error: Error) => publish({ state: 'error', message: error.message }))

  setTimeout(() => {
    void checkForUpdates()
  }, 5_000)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updatesSupported()) {
    publish({
      state: 'disabled',
      message: app.isPackaged
        ? 'Updates disabled by DATUS_DESKTOP_DISABLE_UPDATES'
        : 'Development builds do not auto-update'
    })
    return status
  }
  publish({ state: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (cause) {
    publish({ state: 'error', message: cause instanceof Error ? cause.message : String(cause) })
  }
  return status
}

export function quitAndInstall(): void {
  if (status.state !== 'downloaded') return
  autoUpdater.quitAndInstall()
}
