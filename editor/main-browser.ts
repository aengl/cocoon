import { exec } from 'child_process';
import opn from 'opn';
import { initialise } from './main-common';
import { createURI } from './uri';

export async function initialiseBrowser(
  definitionsPath?: string,
  browserPath?: string
) {
  await initialise();
  const uri = createURI('editor.html', { definitionsPath });
  if (browserPath) {
    exec(`"${browserPath}" "${uri}"`);
  } else {
    opn(uri);
  }
}
