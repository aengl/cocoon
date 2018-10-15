import { ipcMain, ipcRenderer } from 'electron';
import { NodeStatus } from '../core/graph';

/* ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~ ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^
 * Definitions
 * ~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^~^ */

export type DefinitionsChangedListener = (
  event: Electron.Event,
  definitionsPath: string
) => void;

export function rendererOnDefinitionsChanged(
  listener: DefinitionsChangedListener
) {
  ipcRenderer.on('definitions-changed', listener);
}

export function rendererRemoveDefinitionsChanged(
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

export function rendererOnDefinitionsError(listener: DefinitionsErrorListener) {
  ipcRenderer.on('definitions-error', listener);
}

export function rendererRemoveDefinitionsError(
  listener: DefinitionsErrorListener
) {
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

export function rendererSendOpenDefinitions(definitionsPath: string) {
  ipcRenderer.send('open-definitions', definitionsPath);
}

export function mainOnEvaluateNode(
  listener: (event: Electron.Event, nodeId: string) => void
) {
  ipcMain.on('evaluate-node', listener);
}

export function rendererSendEvaluateNode(nodeId: string) {
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

export function rendererSendOpenDataViewWindow(nodeId: string) {
  ipcRenderer.send('open-data-view-window', nodeId);
}

export type DataViewWindowUpdateListener = (
  event: Electron.Event,
  renderingData: any
) => void;

export function rendererOnDataViewWindowUpdate(
  listener: DataViewWindowUpdateListener
) {
  ipcRenderer.on('data-view-window-update', listener);
}

export function rendererRemoveDataViewWindowUpdate(
  listener: DataViewWindowUpdateListener
) {
  ipcRenderer.removeListener('data-view-window-update', listener);
}

export function rendererSendDataViewWindowUpdate(
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
  status: NodeStatus
) => void;

export function rendererOnNodeStatusUpdate(listener: NodeStatusUpdateListener) {
  ipcRenderer.on('node-status-update', listener);
}

export function rendererRemoveNodeStatusUpdate(
  listener: NodeStatusUpdateListener
) {
  ipcRenderer.removeListener('node-status-update', listener);
}

export function coreSendNodeStatusUpdate(
  webContents: Electron.WebContents | undefined,
  nodeId: string,
  status: NodeStatus
) {
  if (webContents) {
    webContents.send('node-status-update', nodeId, status);
  }
}

export type NodeEvaluatedListener = (
  event: Electron.Event,
  nodeId: string
) => void;

export function rendererOnNodeEvaluated(listener: NodeEvaluatedListener) {
  ipcRenderer.on('node-evaluated', listener);
}

export function rendererRemoveNodeEvaluated(listener: NodeEvaluatedListener) {
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

export function rendererOnNodeError(listener: NodeErrorListener) {
  ipcRenderer.on('node-error', listener);
}

export function rendererRemoveNodeError(listener: NodeErrorListener) {
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
