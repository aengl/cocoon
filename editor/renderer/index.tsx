import electron from 'electron';
import React from 'react';
import ReactDOM from 'react-dom';
import { Editor } from './Editor';

const remote = electron.remote;

if (window.location.pathname.endsWith('/editor.html')) {
  ReactDOM.render(
    <Editor definitionPath="test.yml" />,
    document.getElementById('editor')
  );
} else if (window.location.pathname.endsWith('/data.html')) {
  // ReactDOM.render(
  //   <EditorNodeData
  //     x={0}
  //     y={0}
  //     width={500}
  //     height={500}
  //     node={(global as any).graph[1]}
  //   />,
  //   document.getElementById('data')
  // );
  console.warn((remote.getCurrentWindow() as any).renderingData);
}
