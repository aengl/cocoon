import opn from 'opn';
import { onOpenDataViewWindow } from '../common/ipc';
import { createURI, initialise } from './main-common';

// TODO: serve files statically!
// For now, you can:
// cd editor/ui
// python3 -m http.server 32901

export async function initialiseBrowser(definitionsPath?: string) {
  await initialise().then(async () => {
    // Open data view windows
    onOpenDataViewWindow(async args => {
      const { nodeId } = args;
      opn(createURI('dataView.html', { nodeId }));
    });

    // Create main window
    opn(createURI('editor.html', { definitionsPath }));
  });
}
