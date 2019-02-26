import _ from 'lodash';
import React from 'react';
import ReactDOM from 'react-dom';
import { createGlobalStyle } from 'styled-components';
import {
  initialiseIPC,
  onClientDisconnect,
  onClientReconnect,
} from '../../common/ipc';
import { createURI } from '../uri';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';
import { TooltipStyle } from './tooltips';

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

function initialiseWindow() {
  const pathname = window.location.pathname;
  if (pathname.endsWith('/editor.html')) {
    initialiseEditorWindow();
  }
  if (pathname.endsWith('/dataView.html')) {
    initialiseDataViewWindow();
  }
}

function initialiseEditorWindow() {
  // Load initial definitions file
  const definitionsPath = parseQuery().definitionsPath;
  if (definitionsPath === undefined) {
    const lastDefinitionsPath = window.localStorage.getItem('definitionsPath');
    if (lastDefinitionsPath) {
      window.location.assign(
        createURI('editor.html', { definitionsPath: lastDefinitionsPath })
      );
    }
  } else {
    window.localStorage.setItem('definitionsPath', definitionsPath);
  }

  // Mount editor
  ReactDOM.render(
    <>
      <GlobalStyle />
      <TooltipStyle />
      <Editor definitionsPath={definitionsPath} />
    </>,
    document.getElementById('app')
  );
}

function initialiseDataViewWindow() {
  const nodeId = parseQuery().nodeId;
  if (nodeId === undefined) {
    throw new Error(`missing "nodeId" query parameter`);
  }
  ReactDOM.render(
    <>
      <GlobalStyle />
      <DataViewWindow nodeId={nodeId} />
    </>,
    document.getElementById('app')
  );
}

// Connect IPC client, then create the window
initialiseIPC().then(() => {
  initialiseWindow();

  // Handle IPC disconnects -- we need to completely erase the DOM since the IPC
  // listeners attached to the components are likely no longer valid
  onClientDisconnect(() => {
    ReactDOM.render(
      <>
        <GlobalStyle />
      </>,
      document.getElementById('app')
    );
  });

  // Restore the window when reconnected
  onClientReconnect(() => {
    // TODO: re-initialisation without reloading is still unstable
    // initialiseWindow();
    window.location.reload();
  });
});

// https://github.com/ayu-theme/ayu-colors/
const GlobalStyle = createGlobalStyle`
  :root {
    --color-background: #0d131a;
    --color-foreground: #bfbab0;
    --color-background-error: hsl(0, 72%, 40%);
    --color-foreground-error: white;
    --color-ui: #475059;
    --color-ui-line: #050d15;
    --color-highlight: #ffee99;
    --color-red: #ff3333;
    --color-blue: #39bae6;
    --color-mint: #95e6cb;
    --color-green: #c2d94c;
    --color-orange: #ff7733;
    --color-purple: #a37acc;
    --font-size-small: 12px;
  }
  body {
    color: var(--color-foreground);
    background-color: var(--color-background);
    font-family: Avenir, sans-serif;
    margin: 0;
    padding: 0;
    cursor: default;
  }
  * {
    box-sizing: border-box;
  }
  *:focus {
    outline: 0;
  }`;
