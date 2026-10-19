/** Brücke zwischen Oberfläche und Hauptprozess (läuft isoliert, ohne Node-Zugriff). */

import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('bridge', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke('api', method, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  /** Dateipfad einer per Drag & Drop abgelegten Datei */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform,
})
