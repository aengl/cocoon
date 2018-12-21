import { Window } from 'carlo';

export interface EditorWindowData {
  definitionsPath: string | null;
  windowTitle: string;
}

export interface EditorBrowserWindow extends Window, EditorWindowData {}

export interface DataViewWindowData {
  nodeId: string;
}

export interface DataViewBrowserWindow extends Window, DataViewWindowData {}
