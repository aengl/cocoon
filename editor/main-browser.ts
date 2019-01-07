import opn from 'opn';
import { onOpenDataViewWindow } from '../common/ipc';
import { createURI, initialise } from './main-common';

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
