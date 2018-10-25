import { ipcMain, ipcRenderer } from 'electron';

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Definitions
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export type DefinitionsChangedListener = (
  event: Electron.Event,
  definitionsPath: string
) => void;

export function uiOnDefinitionsChanged(listener: DefinitionsChangedListener) {
  ipcRenderer.on('definitions-changed', listener);
}

export function uiRemoveDefinitionsChanged(
  listener: DefinitionsChangedListener
) {
  ipcRenderer.removeListener('definitions-changed', listener);
}

export function coreSendDefinitionsChanged(
  webContents: Electron.WebContents | undefined,
  definitionsPath: string
) {
  if (webContents) {
    webContents.send('definitions-changed', definitionsPath);
  }
}

export type DefinitionsErrorListener = (
  event: Electron.Event,
  error: Error
) => void;

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Data View Window
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function mainOnOpenDataViewWindow(
  listener: (event: Electron.Event, nodeId: string) => void
) {
  ipcMain.on('open-data-view-window', listener);
}

export function uiSendOpenDataViewWindow(nodeId: string) {
  ipcRenderer.send('open-data-view-window', nodeId);
}

export type DataViewWindowUpdateListener = (
  event: Electron.Event,
  renderingData: any
) => void;

export function uiOnDataViewWindowUpdate(
  listener: DataViewWindowUpdateListener
) {
  ipcRenderer.on('data-view-window-update', listener);
}

export function uiRemoveDataViewWindowUpdate(
  listener: DataViewWindowUpdateListener
) {
  ipcRenderer.removeListener('data-view-window-update', listener);
}

export function uiSendDataViewWindowUpdate(
  window: Electron.BrowserWindow,
  renderingData: any
) {
  window.webContents.send('data-view-window-update', renderingData);
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Memory
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function mainOnGetMemoryUsage(
  listener: (event: Electron.Event) => void
) {
  ipcMain.on('get-memory-usage', listener);
}

export function uiSendGetMemoryUsage() {
  ipcRenderer.send('get-memory-usage');
}

export function mainSendMemoryUsage(
  event: Electron.Event,
  memoryUsage: NodeJS.MemoryUsage
) {
  event.sender.send('memory-usage', memoryUsage);
}

export type MemoryUsageListener = (
  event: Electron.Event,
  memoryUsage: NodeJS.MemoryUsage
) => void;

export function uiOnMemoryUsage(listener: MemoryUsageListener) {
  ipcRenderer.on('memory-usage', listener);
}

export function uiRemoveMemoryUsage(listener: MemoryUsageListener) {
  ipcRenderer.removeListener('memory-usage', listener);
}
