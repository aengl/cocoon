import * as fs from 'fs';
import * as yaml from 'js-yaml';

process.chdir(__dirname);

function writeSchema(path: string, schema: object) {
  const jsonSchema = JSON.stringify(schema, undefined, 2);
  fs.writeFileSync(path, jsonSchema);
  process.stdout.write(`created ${path}\n`);
}

// Convert the YML to a JSON schema
['cocoon.yml', 'domain.yml'].forEach(schema => {
  const yamlSchema = fs.readFileSync(schema).toString();
  const jsonSchemaName = schema.replace('.yml', '.json');
  writeSchema(jsonSchemaName, yaml.load(yamlSchema));
});
