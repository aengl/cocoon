import {
  initialiseIPC,
  onClientDisconnect,
  onClientReconnect,
} from '@cocoon/ipc';
import { ProcessName } from '@cocoon/types';
import React from 'react';
import ReactDOM from 'react-dom';
import { createGlobalStyle } from 'styled-components';
import { navigate, parseEditorSearch } from '../uri';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';
import { getLastOpened, updateRecentlyOpened } from './storage';
import { TextEditorSidebar } from './TextEditorSidebar';
import { theme } from './theme';
import { TooltipStyle } from './Tooltip';

const debug = require('debug')('ui:index');

function initialiseWindow() {
  localStorage.debug = 'cocoon:*,editor:*,ui:*';
  const pathname = window.location.pathname;
  if (pathname.endsWith('/editor.html')) {
    initialiseEditorWindow();
  }
  if (pathname.endsWith('/node.html')) {
    initialiseDataViewWindow();
  }
}

function initialiseEditorWindow() {
  // Load initial Cocoon file
  const { search } = parseEditorSearch();
  if (!search.file) {
    const lastPath = getLastOpened();
    if (lastPath) {
      debug(`redirecting to last opened Cocoon file at "${lastPath}"`);
      navigate(lastPath);
    }
  } else {
    updateRecentlyOpened(search.file);
  }
  if (!search.file) {
    throw new Error(`no Cocoon file specified`);
  }

  // Mount editor
  ReactDOM.render(
    <>
      <GlobalStyle />
      <TooltipStyle />
      <TextEditorSidebar>
        <Editor cocoonFilePath={search.file} />
      </TextEditorSidebar>
    </>,
    document.getElementById('app')
  );
}

function initialiseDataViewWindow() {
  const { all, search } = parseEditorSearch();
  if (!search.nodeId) {
    throw new Error(`missing "nodeId" in URL search`);
  }
  ReactDOM.render(
    <>
      <GlobalStyle />
      <DataViewWindow nodeId={search.nodeId} search={all} />
    </>,
    document.getElementById('app')
  );
}

// Connect IPC client, then create the window
initialiseIPC(ProcessName.CocoonEditorUI).then(() => {
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
    --color-faded: ${theme.common.fg.fade(0.6).hex()};
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
`;
