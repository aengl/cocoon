import _ from 'lodash';

export interface CocoonUriArgs {
  file?: string;
  nodeId?: string;
}

export const baseUrl = 'http://127.0.0.1:32901';

export function createURI(file: string, args: CocoonUriArgs) {
  const query = Object.keys(args)
    .reduce((parts: string[], key) => {
      const value = args[key];
      if (!_.isNil(value)) {
        parts.push(`${key}=${value}`);
      }
      return parts;
    }, [])
    .join('&');
  return `${baseUrl}/${file}${query ? '?' + query : ''}`;
}

export function parseQuery(): CocoonUriArgs {
  const query = window.location.search.substring(1);
  return query
    .split('&')
    .map(v => v.split('='))
    .reduce(
      (all, pair) => _.assign(all, { [pair[0]]: decodeURIComponent(pair[1]) }),
      {}
    );
}

export function navigate(definitionsPath: string) {
  window.location.assign(createURI('editor.html', { file: definitionsPath }));
}
