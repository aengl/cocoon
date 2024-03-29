import fs from 'fs';
import resolveUri from './resolveUri';

/**
 * Reads the body from a URI request. If the URI is a `file://` URI it is
 * equivalent to reading the file via `fs`.
 * @param uri The URI to request.
 * @param request Dependency injection for the request function.
 * @param parse Parser for the results.
 * @node
 */
export default async function<T = string>(
  uri: string,
  request: (url: string) => Promise<string>,
  parse: (body: string, isFile: boolean) => T | Promise<T>
) {
  const url = resolveUri(uri);
  if (url.protocol.startsWith('file')) {
    return parse(
      await fs.promises.readFile(decodeURIComponent(url.pathname), {
        encoding: 'utf8',
      }),
      true
    );
  }
  return parse(await request(url.href), false);
}
