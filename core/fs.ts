import fs from 'fs';
import yaml from 'js-yaml';
import stringify from 'json-stable-stringify';
import _ from 'lodash';
import path from 'path';
import util from 'util';

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

/**
 * Expands `~` into the user's home directory.
 * @param filePath A path.
 */
export function expandPath(filePath: string) {
  if (filePath[0] === '~') {
    return path.join(process.env.HOME || '', filePath.slice(1));
  }
  return filePath;
}

/**
 * Resolves a path relative to a specified root directory.
 *
 * Absolute file paths are simply returned.
 * @param filePath Path to the file.
 * @param root Root to use for relative file paths. If left undefined, relative
 * file paths are checked against the current working directory. If this is a
 * path to a file, the directory path of that file is used.
 */
export function resolvePath(filePath: string, root?: string) {
  return root
    ? path.resolve(expandPath(path.dirname(root)), filePath)
    : path.resolve(expandPath(filePath));
}

/**
 * Like `resolvePath`, but requires the path to point to an existing file. Falls
 * back to the current root directory if the file is not found.
 * @param filePath Path to the file.
 * @param root Root to use for relative file paths. If left undefined, relative
 * file paths are checked against the current working directory. If this is a
 * path to a file, the directory path of that file is used.
 */
export function checkFile(filePath: string, root?: string) {
  // Try to resolve the path locally relative to the root
  if (root) {
    const resolvedPath = resolvePath(filePath, root);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }
  // Try to resolve the path locally relative to the working directory
  filePath = expandPath(filePath);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

/**
 * Like `findFile`, but throws an error if the file is not found.
 * @param filePath Path to the file.
 * @param root Root to use for relative file paths. If left undefined, relative
 * file paths are checked against the current working directory. If this is a
 * path to a file, the directory path of that file is used.
 */
export function findFile(filePath: string, root?: string) {
  const result = checkFile(filePath, root);
  if (result) {
    return result;
  }
  throw new Error(`file not found: "${filePath}" ${root}`);
}

/**
 * Reads a file.
 * @param filePath Path to the file.
 * @param root Root to use for relative file paths.
 */
export function readFile(filePath: string, root?: string) {
  return readFileAsync(findFile(filePath, root)!, {
    encoding: 'utf8',
  });
}

/**
 * Reads JSON from a file.
 * @param filePath Path to the JSON file.
 * @param root Root to use for relative file paths.
 */
export async function parseJsonFile(filePath: string, root?: string) {
  const contents = await readFile(filePath, root);
  return JSON.parse(contents);
}

/**
 * Reads and parses a YML file.
 * @param yamlPath Path to the YML file.
 * @param root Root to use for relative file paths.
 */
export async function parseYamlFile<T>(
  filePath: string,
  root?: string
): Promise<T> {
  const contents = await readFile(filePath, root);
  return yaml.load(contents) as T;
}

/**
 * Encodes data as a prettified JSON string.
 * @param data The data to encode to JSON.
 * @param stable If true, enables stable sorting of object keys.
 */
export function encodeAsPrettyJson(data: any, stable = false) {
  if (stable) {
    return stringify(data, { space: 2, replacer: limitPrecision });
  }
  return JSON.stringify(data, limitPrecision, 2);
}

/**
 * Writes data encoded as JSON to a file.
 * @param exportPath Path to the file to write.
 * @param data The data to encode to JSON and write to the file.
 * @param debug An instance of the `debug` module. Will be used to print a
 * descriptive message.
 */
export async function writeJsonFile(
  exportPath: string,
  data: any,
  root?: string,
  debug?: (...args: any[]) => void
) {
  const json = JSON.stringify(data, limitPrecision);
  const resolvedPath = resolvePath(exportPath, root);
  await writeFileAsync(resolvedPath, json);
  if (debug) {
    debug(`exported JSON to ${resolvedPath} (${json.length}b)`);
  }
}

/**
 * Writes data encoded as pretty JSON to a file.
 * @param exportPath Path to the file to write.
 * @param data The data to encode to JSON and write to the file.
 * @param stable If true, enables stable sorting of object keys.
 * @param debug An instance of the `debug` module. Will be used to print a
 * descriptive message.
 */
export async function writePrettyJsonFile(
  exportPath: string,
  data: any,
  stable = false,
  root?: string,
  debug?: (...args: any[]) => void
) {
  const json = encodeAsPrettyJson(data, stable);
  const resolvedPath = resolvePath(exportPath, root);
  await writeFileAsync(resolvedPath, json);
  if (debug) {
    debug(`exported pretty JSON to ${resolvedPath} (${json.length}b)`);
  }
}

/**
 * Writes data encoded as YAML to a file.
 * @param exportPath Path to the file to write.
 * @param data The data to encode to YAML and write to the file.
 * @param debug An instance of the `debug` module. Will be used to print a
 * descriptive message.
 */
export async function writeYamlFile(
  exportPath: string,
  data: any,
  root?: string,
  debug?: (...args: any[]) => void
) {
  const resolvedPath = resolvePath(exportPath, root);
  const contents = yaml.dump(data);
  await writeFileAsync(resolvedPath, contents);
  if (debug) {
    debug(`exported YAML to ${resolvedPath}`);
  }
  return contents;
}

function limitPrecision(_0: string, value: any) {
  return _.isNumber(value) ? _.round(value, 2) : value;
}
