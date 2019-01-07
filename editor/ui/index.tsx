import _ from 'lodash';
import React from 'react';
import ReactDOM from 'react-dom';
import { initialiseIPC, sendOpenDefinitions } from '../../common/ipc';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';

localStorage.debug = 'core:*,main:*,editor:*';

function parseQuery(): { [key: string]: string } {
  const query = window.location.search.substring(1);
  return query
    .split('&')
    .map(v => v.split('='))
    .reduce(
      (all, pair) => _.assign(all, { [pair[0]]: decodeURIComponent(pair[1]) }),
      {}
    );
}

function initialiseEditorWindow() {
  ReactDOM.render(<Editor />, document.getElementById('editor'));

  // Load initial definitions file
  const definitionsPath = parseQuery().definitionsPath;
  if (definitionsPath === undefined) {
    const lastDefinitionsPath = window.localStorage.getItem('definitionsPath');
    if (lastDefinitionsPath) {
      sendOpenDefinitions({ definitionsPath: lastDefinitionsPath });
    }
  } else {
    sendOpenDefinitions({ definitionsPath });
    window.localStorage.setItem('definitionsPath', definitionsPath);
  }
}

function initialiseDataViewWindow() {
  const nodeId = parseQuery().nodeId;
  if (nodeId === undefined) {
    throw new Error(`missing "nodeId" query parameter`);
  }
  ReactDOM.render(
    <DataViewWindow nodeId={nodeId} />,
    document.getElementById('data-view')
  );
}

// Connect IPC client, then create the window
initialiseIPC().then(() => {
  const pathname = window.location.pathname;
  if (pathname.endsWith('/editor.html')) {
    initialiseEditorWindow();
  }
  if (pathname.endsWith('/dataView.html')) {
    initialiseDataViewWindow();
  }
});
