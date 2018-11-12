import * as fs from 'fs';
import * as http from 'http';

const port = 31337;

// Serve the JSON schema locally
process.chdir(__dirname);
process.stdout.write(`serving schema locally on port ${port}\n`);
http
  .createServer((req, res) => {
    res.setHeader('Content-type', 'application/json');
    const schemaPath = `.${req.url}`;
    process.stdout.write(`${schemaPath}\n`);
    const schema = fs.readFileSync(schemaPath);
    res.end(schema);
  })
  .listen(port);
