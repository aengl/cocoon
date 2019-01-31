import opn from 'opn';
import { initialise } from './main-common';
import { createURI } from './uri';

export async function initialiseBrowser(definitionsPath?: string) {
  await initialise();
  opn(createURI('editor.html', { definitionsPath }));
}
