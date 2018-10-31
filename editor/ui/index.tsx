import electron from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { deserialiseNode, sendOpenDefinitions } from '../../common/ipc';
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
    // uiSendOpenDefinitions(definitionsPath);
    sendOpenDefinitions({ definitionsPath });
  }

  // Handle drag & drop of definition files into the editor
  document.body.ondragover = event => {
    event.preventDefault();
  };
  document.body.ondrop = event => {
    event.preventDefault();
    sendOpenDefinitions({ definitionsPath: event.dataTransfer.files[0].path });
  };
}

function initialiseDataViewWindow() {
  const {
    serialisedNode,
  } = electron.remote.getCurrentWindow() as DataViewBrowserWindow;
  const node = deserialiseNode(serialisedNode);
  ReactDOM.render(
    <DataViewWindow node={node} />,
    document.getElementById('data-view')
  );
}

const pathname = window.location.pathname;
if (pathname.endsWith('/editor.html')) {
  initialiseEditorWindow();
}
if (pathname.endsWith('/data-view.html')) {
  initialiseDataViewWindow();
}
