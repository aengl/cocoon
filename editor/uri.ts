import _ from 'lodash';

export interface CocoonUriArgs {
  file?: string | null;
  nodeId?: string | null;
}

export const baseUrl = 'http://127.0.0.1:32901';

export function createEditorURI(file: string, args: CocoonUriArgs) {
  const search = Object.keys(args)
    .reduce((parts: string[], key) => {
      const value = args[key];
      if (!_.isNil(value)) {
        parts.push(`${key}=${value}`);
      }
      return parts;
    }, [])
    .join('&');
  return `${baseUrl}/${file}${search ? '?' + search : ''}`;
}

export function parseEditorSearch(): CocoonUriArgs {
  const params = new URLSearchParams(window.location.search);
  return {
    file: params.get('file'),
    nodeId: params.get('nodeId'),
  };
}

export function navigate(definitionsPath: string) {
  window.location.assign(
    createEditorURI('editor.html', { file: definitionsPath })
  );
}
