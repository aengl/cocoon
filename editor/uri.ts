import _ from 'lodash';

export const baseUrl = 'http://127.0.0.1:32901';

export function createURI(file: string, args: object) {
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
