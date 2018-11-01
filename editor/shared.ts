import { BrowserWindow } from 'electron';

export interface EditorWindowData {
  definitionsPath: string | null;
  windowTitle: string;
}

export interface EditorBrowserWindow extends BrowserWindow, EditorWindowData {}

export interface DataViewWindowData {
  nodeId: string;
}

export interface DataViewBrowserWindow
  extends BrowserWindow,
    DataViewWindowData {}
