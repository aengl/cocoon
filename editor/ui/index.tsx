import _ from 'lodash';
import React from 'react';
import ReactDOM from 'react-dom';
import { createGlobalStyle } from 'styled-components';
import { initialiseIPC, sendOpenDefinitions } from '../../common/ipc';
import { ContextMenuStyle } from './contextMenu';
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

function initialiseEditorWindow() {
  ReactDOM.render(
    <>
      <GlobalStyle />
      <TooltipStyle />
      <ContextMenuStyle />
      <Editor />
    </>,
    document.getElementById('editor')
  );

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
    <>
      <GlobalStyle />
      <DataViewWindow nodeId={nodeId} />
    </>,
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
