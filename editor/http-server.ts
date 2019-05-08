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
      const urlInfo = url.parse(request.url);
      if (urlInfo.pathname === '/component') {
        const params = new URLSearchParams(urlInfo.search);
        const filePath = params.get('path');
        debug(`view component at "${filePath}"`);
        serveStaticFile(filePath, response);
      } else {
        const filePath = path.join(serverRoot, urlInfo.pathname || '');
        debug(`${request.url} => ${filePath}`);
        serveStaticFile(filePath, response);
      }
    }
  })
  .listen(32901);

debug(`listening`);
