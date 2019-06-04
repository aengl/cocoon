import React from 'react';
import ReactDOM from 'react-dom';
import { createGlobalStyle } from 'styled-components';
import {
  initialiseIPC,
  onClientDisconnect,
  onClientReconnect,
} from '../../common/ipc';
import { navigate, parseEditorSearch } from '../uri';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';
import { getLastOpened, updateRecentlyOpened } from './storage';
import { TextEditorSidebar } from './TextEditorSidebar';
import { theme } from './theme';
import { TooltipStyle } from './Tooltip';

localStorage.debug = 'core:*,main:*,editor:*';

const debug = require('debug')('editor:index');

function initialiseWindow() {
  const pathname = window.location.pathname;
  if (pathname.endsWith('/editor.html')) {
    initialiseEditorWindow();
  }
  if (pathname.endsWith('/node.html')) {
    initialiseDataViewWindow();
  }
}

function initialiseEditorWindow() {
  // Load initial definitions file
  const definitionsPath = parseEditorSearch().file;
  if (!definitionsPath) {
    const lastDefinitionsPath = getLastOpened();
    if (lastDefinitionsPath) {
      debug(
        `redirecting to last opened definitions file at "${lastDefinitionsPath}"`
      );
      navigate(lastDefinitionsPath);
    }
  } else {
    updateRecentlyOpened(definitionsPath);
  }
  if (!definitionsPath) {
    throw new Error(`no Cocoon definitions path specified`);
  }

  // Mount editor
  ReactDOM.render(
    <>
      <GlobalStyle />
      <TooltipStyle />
      <TextEditorSidebar>
        <Editor definitionsPath={definitionsPath} />
      </TextEditorSidebar>
    </>,
    document.getElementById('app')
  );
}

function initialiseDataViewWindow() {
  const nodeId = parseEditorSearch().nodeId;
  if (!nodeId) {
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

const GlobalStyle = createGlobalStyle`
  @import url('https://fonts.googleapis.com/css?family=Roboto:300');
  :root {
    --font-size-small: 12px;
  }
  body {
    color: ${theme.common.fg.hex()};
    background-color: ${theme.common.bg.hex()};
    font-family: Roboto, Avenir, sans-serif;
    margin: 0;
    padding: 0;
    cursor: default;
    font-weight: 300;

    /* Prevents history navigation via touch scroll */
    overscroll-behavior: none;
  }
  * {
    box-sizing: border-box;
  }
  *:focus {
    outline: 0;
  }
  a {
    color: ${theme.syntax.entity.hex()}
  }
  input, textarea {
    border: 2px inset ${theme.syntax.keyword
      .darken(1)
      .fade(0.2)
      .hex()};
    color: white;
    background-color: transparent;
    margin: 0.5em 0;
    padding: 0.5em;
  }
  button {
    border: 0;
    border-radius: 5px;
    color: white;
    background-color: ${theme.syntax.keyword
      .darken(1)
      .fade(0.2)
      .hex()};
    margin: 0.5em 0;
    padding: 0.5em;
  }
`;
