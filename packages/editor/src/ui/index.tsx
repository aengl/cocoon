import Debug from 'debug';
import React from 'react';
import ReactDOM from 'react-dom';
import { navigate, parseEditorSearch } from '../uri';
import { DataViewWindow } from './DataViewWindow';
import { Editor } from './Editor';
import { initialiseIPC } from './ipc';
import { getLastOpened, updateRecentlyOpened } from './storage';
import { TextEditorSidebar } from './TextEditorSidebar';
import { theme } from './theme';
import { TooltipStyle } from './Tooltip';

const debug = Debug('ui:index');

function initialiseWindow() {
  localStorage.debug = 'cocoon:*,ui:*';
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
      <DataViewWindow nodeId={search.nodeId} search={all} />
      <GlobalStyle />
    </>,
    document.getElementById('app')
  );
}

// Connect IPC client, then create the window
initialiseIPC(
  () => {
    // Handle IPC disconnects -- we need to completely erase the DOM since the
    // IPC listeners attached to the components are likely no longer valid
    ReactDOM.render(
      <>
        <GlobalStyle />
      </>,
      document.getElementById('app')
    );
  },
  () => {
    // TODO: re-initialisation without reloading requires that we first unload
    // all registered IPC events.
    // initialiseWindow();
    window.location.reload();
  }
).then(() => {
  initialiseWindow();
});

const GlobalStyle = () => (
  <style jsx global>{`
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
      color: ${theme.syntax.entity.hex()};
    }
  `}</style>
);
