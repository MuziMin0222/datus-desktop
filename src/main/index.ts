import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'

import { IPC, type PermissionProfile, type SaveConnectionInput, type TestRemoteInput } from '@shared/ipc'
import { BackendController, normalizeBaseUrl } from './controller'
import { registerArtifactProtocol, registerArtifactScheme } from './artifacts/artifactProtocol'
import { installAuthHeaderInjection, installInsecureTlsPolicy, installNavigationPolicy } from './security'
import { getSettings, setPermissionProfile, updateSettings } from './settings'
import { localModeSupported, resolveWorkspace } from './sidecar/paths'
import { ProxyToolExecutor } from './tools/proxyExecutor'
import { checkForUpdates, getUpdateStatus, initAutoUpdater, onUpdateStatus, quitAndInstall } from './updates'

let controller: BackendController
let proxyExecutor: ProxyToolExecutor

registerArtifactScheme()

function broadcastStatus(): void {
  const status = controller.local.getStatus()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.statusEvent, status)
  }
}

function broadcastUpdateStatus(): void {
  const status = getUpdateStatus()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.updateStatusEvent, status)
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  installNavigationPolicy(window)
  window.once('ready-to-show', () => window.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function registerIpc(): void {
  ipcMain.handle(IPC.getState, () => controller.snapshot())

  ipcMain.handle(IPC.saveConnection, async (_event, input: SaveConnectionInput) => {
    if (input.permissionProfile) setPermissionProfile(input.permissionProfile as PermissionProfile)
    return controller.save({ ...input, workspace: input.workspace ?? getSettings().workspace })
  })

  ipcMain.handle(IPC.chooseWorkspace, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a workspace folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const workspace = result.filePaths[0]
    updateSettings({ mode: getSettings().mode, workspace })
    controller.settings = getSettings()
    return workspace
  })

  ipcMain.handle(IPC.testRemote, (_event, input: TestRemoteInput) => controller.testRemote(input))

  ipcMain.handle(IPC.startLocal, async () => {
    if (!localModeSupported()) {
      return controller.local.getStatus()
    }
    updateSettings({ mode: 'local', workspace: getSettings().workspace })
    return controller.apply(getSettings())
  })

  ipcMain.handle(IPC.stopLocal, () => controller.local.stop())

  ipcMain.handle(IPC.setPermissionProfile, (_event, profile: PermissionProfile) => {
    setPermissionProfile(profile)
    controller.settings = getSettings()
  })

  ipcMain.handle(IPC.executeProxiedTool, (_event, request) => proxyExecutor.execute(request))

  ipcMain.handle(IPC.getUpdateStatus, () => getUpdateStatus())
  ipcMain.handle(IPC.checkForUpdates, () => checkForUpdates())
  ipcMain.handle(IPC.installUpdate, () => quitAndInstall())

  ipcMain.handle(IPC.readLogs, () => controller.local.readLogs())
}

app.whenReady().then(() => {
  controller = new BackendController(getSettings())
  proxyExecutor = new ProxyToolExecutor(() =>
    controller.settings.mode === 'local' ? resolveWorkspace(controller.settings) : null
  )
  registerArtifactProtocol(() => controller.getAuthTarget())
  installAuthHeaderInjection(() => controller.getAuthTarget())
  installInsecureTlsPolicy(() => {
    const settings = controller.settings
    const baseUrl = normalizeBaseUrl(settings.remote.baseUrl)
    if (!baseUrl) return null
    try {
      return { host: new URL(baseUrl).host, allow: settings.remote.allowInsecureTls }
    } catch {
      return null
    }
  })
  registerIpc()
  controller.local.onStatus(() => broadcastStatus())
  initAutoUpdater()
  onUpdateStatus(() => broadcastUpdateStatus())

  createWindow()

  const settings = getSettings()
  if (settings.mode === 'local' && localModeSupported()) {
    void controller.apply(settings)
  } else if (settings.mode === 'remote') {
    void controller.apply(settings)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void controller.local.stop()
})
