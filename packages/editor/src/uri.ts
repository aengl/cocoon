export interface CocoonUriSearch {
  file?: string | null;
  nodeId?: string | null;
}

export const baseUrl = 'http://127.0.0.1:22242';

export function createEditorURI(file: string, args: CocoonUriSearch) {
  const search = Object.keys(args)
    .reduce((parts: string[], key) => {
      const value = args[key];
      if (value) {
        parts.push(`${key}=${value}`);
      }
      return parts;
    }, [])
    .join('&');
  return `${baseUrl}/${file}${search ? '?' + search : ''}`;
}

export function parseEditorSearch() {
  const all = new URLSearchParams(window.location.search);
  const search: CocoonUriSearch = {
    file: all.get('file'),
    nodeId: all.get('nodeId'),
  };
  return { all, search };
}

export function navigate(cocoonFilePath: string) {
  window.location.assign(
    createEditorURI('editor.html', { file: cocoonFilePath })
  );
}
