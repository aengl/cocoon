import { BrowserWindow } from 'electron';

export interface EditorWindowData {
  definitionsPath: string | null;
}

export interface EditorBrowserWindow extends BrowserWindow, EditorWindowData {}

export interface DataViewWindowData {
  serialisedNode: object;
}

export interface DataViewBrowserWindow
  extends BrowserWindow,
    DataViewWindowData {}
