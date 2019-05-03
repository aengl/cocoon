const fs = require('fs');
const http = require('http');
const mime = require('mime-types');
const path = require('path');
const url = require('url');

const serverRoot = path.resolve(__dirname, 'ui');
const debug = require('debug')('http:index');

function serveStaticFile(filePath, response) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == 'ENOENT') {
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
    const params = url.parse(request.url);
    const filePath = path.join(serverRoot, params.pathname);
    debug(request.url, '=>', filePath);
    serveStaticFile(filePath, response);
  })
  .listen(32901);

debug(`listening`);
