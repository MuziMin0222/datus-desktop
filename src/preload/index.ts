import { contextBridge, ipcRenderer } from 'electron'

import {
  IPC,
  type BootstrapSnapshot,
  type DesktopApi,
  type SaveConnectionInput,
  type SidecarStatus,
  type TestRemoteInput
} from '@shared/ipc'

const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<BootstrapSnapshot>,
  saveConnection: (input: SaveConnectionInput) =>
    ipcRenderer.invoke(IPC.saveConnection, input) as Promise<BootstrapSnapshot>,
  chooseWorkspace: () => ipcRenderer.invoke(IPC.chooseWorkspace) as Promise<string | null>,
  testRemote: (input: TestRemoteInput) => ipcRenderer.invoke(IPC.testRemote, input),
  startLocal: () => ipcRenderer.invoke(IPC.startLocal) as Promise<SidecarStatus>,
  stopLocal: () => ipcRenderer.invoke(IPC.stopLocal) as Promise<SidecarStatus>,
  setPermissionProfile: (profile) => ipcRenderer.invoke(IPC.setPermissionProfile, profile) as Promise<void>,
  executeProxiedTool: (request) => ipcRenderer.invoke(IPC.executeProxiedTool, request),
  onStatus: (listener: (status: SidecarStatus) => void) => {
    const handler = (_event: unknown, status: SidecarStatus): void => listener(status)
    ipcRenderer.on(IPC.statusEvent, handler)
    return () => ipcRenderer.removeListener(IPC.statusEvent, handler)
  },
  readLogs: () => ipcRenderer.invoke(IPC.readLogs) as Promise<string>
}

contextBridge.exposeInMainWorld('datus', api)
