import fs from 'fs';
import http from 'http';
import mime from 'mime-types';
import path from 'path';
import url from 'url';

const debug = require('debug')('http:index');

const serverRoot = path.resolve(__dirname, 'ui');

function serveStaticFile(filePath, response) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        response.writeHead(404);
        response.end();
      } else {
        response.writeHead(500);
        response.end();
      }
    } else {
      response.writeHead(200, { 'Content-Type': mime.lookup(filePath) });
      response.end(content);
    }
  });
}

http
  .createServer((request, response) => {
    if (!request.url) {
      response.end();
    } else {
      const params = url.parse(request.url);
      const filePath = path.join(serverRoot, params.pathname || '');
      debug(`${request.url} => ${filePath}`);
      serveStaticFile(filePath, response);
    }
  })
  .listen(32901);

debug(`listening`);
