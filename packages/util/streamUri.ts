import fs from 'fs';
import { Stream } from 'stream';
import resolveUri from './resolveUri';

/**
 * Streams the body of a URI request. If the URI is a `file://` URI it is
 * equivalent to reading the file via `fs`.
 * @param uri The URI to request.
 * @param request Dependency injection for the request function.
 * @node
 */
export default function(uri: string, request: (url: string) => Stream) {
  const url = resolveUri(uri);
  return url.protocol.startsWith('file')
    ? fs.createReadStream(url.pathname, { encoding: 'utf8' })
    : request(url.href);
}
