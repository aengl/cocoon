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

export function uiOnDefinitionsError(listener: DefinitionsErrorListener) {
  ipcRenderer.on('definitions-error', listener);
}

export function uiRemoveDefinitionsError(listener: DefinitionsErrorListener) {
  ipcRenderer.removeListener('definitions-error', listener);
}

export function coreSendDefinitionsError(
  webContents: Electron.WebContents | undefined,
  error: Error
) {
  if (webContents) {
    webContents.send('definitions-error', error);
  }
}

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Editor
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export function mainOnOpenDefinitions(
  listener: (event: Electron.Event, definitionsPath: string) => void
) {
  ipcMain.on('open-definitions', listener);
}

export function uiSendOpenDefinitions(definitionsPath: string) {
  ipcRenderer.send('open-definitions', definitionsPath);
}

export function mainOnEvaluateNode(
  listener: (event: Electron.Event, nodeId: string) => void
) {
  ipcMain.on('evaluate-node', listener);
}

export function uiSendEvaluateNode(nodeId: string) {
  ipcRenderer.send('evaluate-node', nodeId);
}

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
 * Nodes
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export type NodeStatusUpdateListener = (
  event: Electron.Event,
  nodeId: string,
  status: import('../core/graph').NodeStatus
) => void;

export function uiOnNodeStatusUpdate(listener: NodeStatusUpdateListener) {
  ipcRenderer.on('node-status-update', listener);
}

export function uiRemoveNodeStatusUpdate(listener: NodeStatusUpdateListener) {
  ipcRenderer.removeListener('node-status-update', listener);
}

export function coreSendNodeStatusUpdate(
  webContents: Electron.WebContents | undefined,
  nodeId: string,
  status: import('../core/graph').NodeStatus
) {
  if (webContents) {
    webContents.send('node-status-update', nodeId, status);
  }
}

export type NodeEvaluatedListener = (
  event: Electron.Event,
  nodeId: string
) => void;

export function uiOnNodeEvaluated(listener: NodeEvaluatedListener) {
  ipcRenderer.on('node-evaluated', listener);
}

export function uiRemoveNodeEvaluated(listener: NodeEvaluatedListener) {
  ipcRenderer.removeListener('node-evaluated', listener);
}

export function coreSendNodeEvaluated(
  webContents: Electron.WebContents | undefined,
  nodeId: string
) {
  if (webContents) {
    webContents.send('node-evaluated', nodeId);
  }
}

export type NodeErrorListener = (
  event: Electron.Event,
  nodeId: string,
  error: Error,
  errorMessage: string
) => void;

export function uiOnNodeError(listener: NodeErrorListener) {
  ipcRenderer.on('node-error', listener);
}

export function uiRemoveNodeError(listener: NodeErrorListener) {
  ipcRenderer.removeListener('node-error', listener);
}

export function coreSendNodeError(
  webContents: Electron.WebContents | undefined,
  nodeId: string,
  error: Error,
  errorMessage: string
) {
  if (webContents) {
    webContents.send('node-error', nodeId, error, errorMessage);
  }
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
