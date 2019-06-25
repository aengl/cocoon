import fs from 'fs';
import http from 'http';
import mime from 'mime-types';
import path from 'path';
import url from 'url';
import util from 'util';

const debug = require('debug')('http:index');

const readFileAsync = util.promisify(fs.readFile);
const existsAsync = util.promisify(fs.exists);

const serverPort = 22242;

const staticFolders = [path.resolve(__dirname, 'ui')];

async function serveStaticFile(
  possibleFilePaths: string[],
  response: http.ServerResponse
) {
  // Take the first file we can find
  const filePath = (await Promise.all(
    possibleFilePaths.map(async p => ((await existsAsync(p)) ? p : null))
  )).find(x => Boolean(x));
  debug(`=> ${filePath}`);

  // Return file contents
  if (filePath) {
    const content = await readFileAsync(filePath, { encoding: 'utf8' });
    response.writeHead(200, {
      'Content-Type': mime.lookup(filePath),
    });
    response.end(content);
  } else {
    response.writeHead(404);
    response.end();
  }
}

process.title = 'cocoon-editor-http';
http
  .createServer((request, response) => {
    try {
      if (!request.url) {
        response.end();
      } else {
        debug(request.url);
        const urlInfo = url.parse(
          request.url === '/' ? '/editor.html' : request.url
        );
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
  .listen(serverPort);

debug(`listening on port ${serverPort}`);
