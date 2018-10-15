import electron from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { rendererSendOpenDefinitions } from '../ipc';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';

const electronWindow = electron.remote.getCurrentWindow();

if (window.location.pathname.endsWith('/editor.html')) {
  ReactDOM.render(<Editor />, document.getElementById('editor'));

  // Load initial definitions file
  const { definitionsPath } = electronWindow as any;
  if (definitionsPath) {
    rendererSendOpenDefinitions(definitionsPath);
  }

  // Handle drag & drop of definition files into the editor
  document.body.ondragover = event => {
    event.preventDefault();
  };
  document.body.ondrop = event => {
    event.preventDefault();
    rendererSendOpenDefinitions(event.dataTransfer.files[0].path);
  };
} else if (window.location.pathname.endsWith('/data.html')) {
  const { nodeId, nodeType, renderingData } = electronWindow as any;
  ReactDOM.render(
    <DataViewWindow
      nodeId={nodeId}
      nodeType={nodeType}
      renderingData={renderingData}
    />,
    document.getElementById('data')
  );
}
