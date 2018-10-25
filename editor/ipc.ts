import { ipcMain, ipcRenderer } from 'electron';

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
