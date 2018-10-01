import fs from 'fs';
import yaml from 'js-yaml';
import stringify from 'json-stable-stringify';
import _ from 'lodash';
import path from 'path';

function limitPrecision(_0: string, value: any) {
  return _.isNumber(value) ? _.round(value, 2) : value;
}

/**
 * Will attempt to resolve a path relative to a specified root directory. Falls
 * back to the current root directory if the file is not found.
 *
 * Absolute file paths are simply returned.
 * @param filePath Path to the file.
 * @param root Root to use for relative file paths. If left undefined, relative
 * file paths are checked against the current working directory. If this is a
 * path to a file, the directory path of that file is used.
 */
export function resolvePath(filePath: string, root?: string) {
  // Try to resolve the path locally relative to the root
  if (root) {
    const resolvedPath = path.resolve(path.dirname(root), filePath);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }
  // Try to resolve the path locally relative to the working directory
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  throw new Error(`file not found: "${filePath}"`);
}

/**
 * Reads JSON from a file.
 * @param filePath Path to the JSON file.
 * @param root Root to use for relative file paths.
 */
export function parseJsonFile(filePath: string, root?: string) {
  return JSON.parse(fs.readFileSync(resolvePath(filePath, root), 'utf8'));
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
export function writeJsonFile(
  exportPath: string,
  data: any,
  debug?: (...args: any[]) => void
) {
  const json = JSON.stringify(data, limitPrecision);
  const resolvedPath = path.resolve(exportPath);
  fs.writeFileSync(resolvedPath, json);
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
export function writePrettyJsonFile(
  exportPath: string,
  data: any,
  stable = false,
  debug?: (...args: any[]) => void
) {
  const json = encodeAsPrettyJson(data, stable);
  const resolvedPath = path.resolve(exportPath);
  fs.writeFileSync(resolvedPath, json);
  if (debug) {
    debug(`exported pretty JSON to ${resolvedPath} (${json.length}b)`);
  }
}

/**
 * Reads and parses a YML file.
 * @param yamlPath Path to the YML file.
 * @param root Root to use for relative file paths.
 */
export function parseYamlFile<T>(yamlPath: string, root?: string): T {
  return yaml.load(fs.readFileSync(resolvePath(yamlPath, root), 'utf8')) as T;
}
