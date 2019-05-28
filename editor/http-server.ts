import http from 'http';
import mime from 'mime-types';
import path from 'path';
import url from 'url';
import { readFile, checkPath } from '../core/fs';

const debug = require('debug')('http:index');

const staticFolders = [
  path.resolve(__dirname, 'ui'),
  // If files are not found in the `ui` folder, fall back to the Monaco editor
  path.resolve(__dirname, '../cocoon-monaco'),
];

async function serveStaticFile(
  possibleFilePaths: string[],
  response: http.ServerResponse
) {
  // Take the first file we can find
  const filePath = (await Promise.all(
    possibleFilePaths.map(p => checkPath(p))
  )).find(x => Boolean(x));
  debug(`=> ${filePath}`);

  // Return file contents
  if (filePath) {
    const content = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mime.lookup(filePath),
    });
    response.end(content);
  } else {
    response.writeHead(404);
    response.end();
  }
}

http
  .createServer((request, response) => {
    try {
      if (!request.url) {
        response.end();
      } else {
        debug(request.url);
        const urlInfo = url.parse(request.url);
        if (urlInfo.pathname === '/component') {
          const params = new URLSearchParams(urlInfo.search);
          const filePath = params.get('path')!;
          serveStaticFile([filePath], response);
        } else {
          const filePaths = staticFolders.map(p =>
            path.join(p, urlInfo.pathname || '')
          );
          serveStaticFile(filePaths, response);
        }
      }
    } catch (error) {
      response.writeHead(500);
      response.end();
    }
  })
  .listen(32901);

debug(`listening`);
