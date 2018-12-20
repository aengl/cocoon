import electron from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { initialiseIPC, sendOpenDefinitions } from '../../common/ipc';
import { DataViewBrowserWindow, EditorBrowserWindow } from '../shared';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';

localStorage.debug = 'core:*,main:*,editor:*';

function initialiseEditorWindow() {
  const {
    definitionsPath,
    windowTitle,
  } = electron.remote.getCurrentWindow() as EditorBrowserWindow;
  ReactDOM.render(
    <Editor windowTitle={windowTitle} />,
    document.getElementById('editor')
  );

  // Load initial definitions file
  if (definitionsPath) {
    sendOpenDefinitions({ definitionsPath });
  }

  // Handle drag & drop of definition files into the editor
  document.body.ondragover = event => {
    event.preventDefault();
  };
  document.body.ondrop = event => {
    event.preventDefault();
    if (event.dataTransfer !== null) {
      sendOpenDefinitions({
        definitionsPath: event.dataTransfer.files[0].path,
      });
    }
  };
}

function initialiseDataViewWindow() {
  const {
    nodeId,
  } = electron.remote.getCurrentWindow() as DataViewBrowserWindow;
  ReactDOM.render(
    <DataViewWindow nodeId={nodeId} />,
    document.getElementById('data-view')
  );
}

// Run IPC server, then create the window
initialiseIPC().then(() => {
  const pathname = window.location.pathname;
  if (pathname.endsWith('/editor.html')) {
    initialiseEditorWindow();
  }
  if (pathname.endsWith('/data-view.html')) {
    initialiseDataViewWindow();
  }
});
