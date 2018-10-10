export function ipcSend(
  ui: Electron.WebContents | undefined,
  channel: string,
  ...args: any[]
) {
  if (ui) {
    ui.send(channel, ...args);
  }
}
