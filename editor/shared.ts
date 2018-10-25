import { BrowserWindow } from 'electron';

export interface EditorWindowData {
  definitionsPath: string | null;
}

export interface EditorBrowserWindow extends BrowserWindow, EditorWindowData {}

export interface DataViewWindowData {
  nodeId: string;
  nodeType: string;
}

export interface DataViewBrowserWindow
  extends BrowserWindow,
    DataViewWindowData {}
