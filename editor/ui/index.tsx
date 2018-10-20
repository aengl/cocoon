import electron from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { uiSendOpenDefinitions } from '../ipc';
import { DataViewBrowserWindow, EditorBrowserWindow } from '../shared';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';

function initialiseEditorWindow() {
  ReactDOM.render(<Editor />, document.getElementById('editor'));

  // Load initial definitions file
  const {
    definitionsPath,
  } = electron.remote.getCurrentWindow() as EditorBrowserWindow;
  if (definitionsPath) {
    uiSendOpenDefinitions(definitionsPath);
  }

  // Handle drag & drop of definition files into the editor
  document.body.ondragover = event => {
    event.preventDefault();
  };
  document.body.ondrop = event => {
    event.preventDefault();
    uiSendOpenDefinitions(event.dataTransfer.files[0].path);
  };
}

function initialiseDataViewWindow() {
  const {
    nodeId,
    nodeType,
    renderingData,
  } = electron.remote.getCurrentWindow() as DataViewBrowserWindow;
  ReactDOM.render(
    <DataViewWindow
      nodeId={nodeId}
      nodeType={nodeType}
      renderingData={renderingData}
    />,
    document.getElementById('data')
  );
}

const pathname = window.location.pathname;
if (pathname.endsWith('/editor.html')) {
  initialiseEditorWindow();
}
if (pathname.endsWith('/data-view.html')) {
  initialiseDataViewWindow();
}
