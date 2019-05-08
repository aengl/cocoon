import { exec } from 'child_process';
import opn from 'opn';
import { initialise } from './main-common';
import { createEditorURI } from './uri';

export async function initialiseBrowser(
  options: {
    coreURI?: string;
    definitionsPath?: string;
    browserPath?: string;
  } = {}
) {
  await initialise(options);
  const uri = createEditorURI('editor.html', {
    file: options.definitionsPath,
  });
  if (options.browserPath) {
    exec(`"${options.browserPath}" "${uri}"`);
  } else {
    opn(uri);
  }
}
