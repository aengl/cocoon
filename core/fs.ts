import fs from 'fs';
import yaml from 'js-yaml';
import stringify from 'json-stable-stringify';
import path from 'path';
import tmp from 'tmp';
import util from 'util';

const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);
const mkdirAsync = util.promisify(fs.mkdir);
const readdirAsync = util.promisify(fs.readdir);
const unlinkAsync = util.promisify(fs.unlink);
const tmpNameAsync = util.promisify(tmp.tmpName);

export interface CommonFsOptions {
  /**
   * Root to use for relative file paths. If left undefined, relative file paths
   * are checked against the current working directory.
   */
  root?: string;

  /**
   * Debug module for reporting.
   */
  debug?: (...args: any[]) => void;
}

export interface CommonFsOptionsWithPredicate extends CommonFsOptions {
  predicate?: (fileName: string) => boolean;
}

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
 */
export function resolvePath(filePath: string, options: CommonFsOptions = {}) {
  return options.root
    ? path.resolve(expandPath(options.root), expandPath(filePath))
    : path.resolve(expandPath(filePath));
}

/**
 * Ensures that a path exists, recursively creating it if necessary.
 * @param pathToCreate The path to create.
 */
export async function createPath(
  pathToCreate: string,
  options: CommonFsOptions = {}
) {
  const resolvedPath = resolvePath(pathToCreate, options);
  await mkdirAsync(resolvedPath, {
    recursive: true,
  });
  return resolvedPath;
}

/**
 * Like `resolvePath`, but requires the path to point to an existing file. Falls
 * back to the current root directory if the file is not found.
 * @param pathToCheck Path to the file.
 */
export function checkPath(pathToCheck: string, options: CommonFsOptions = {}) {
  // Try to resolve the path locally relative to the root
  if (options.root) {
    const resolvedPath = resolvePath(pathToCheck, options);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }
  // Try to resolve the path locally relative to the working directory
  pathToCheck = expandPath(pathToCheck);
  if (fs.existsSync(pathToCheck)) {
    return pathToCheck;
  }
  return;
}

/**
 * Like `findFile`, but throws an error if the file is not found.
 * @param pathToFind Path to the file.
 */
export function findPath(pathToFind: string, options: CommonFsOptions = {}) {
  const result = checkPath(pathToFind, options);
  if (result) {
    return result;
  }
  throw new Error(`file not found: "${pathToFind}"`);
}

export interface ReadFileOptions extends CommonFsOptions {
  /**
   * See `https://nodejs.org/api/fs.html#fs_fs_readfile_path_options_callback`.
   */
  encoding?: string;

  /**
   * See `https://nodejs.org/api/fs.html#fs_fs_readfile_path_options_callback`.
   */
  flag?: string;
}

/**
 * Reads a file. Unlike the Node.js counterpart, it will never return a Buffer,
 * but assume `utf8` as the default encoding.
 * @param filePath Path to the file.
 */
export async function readFile(
  filePath: string,
  options: ReadFileOptions = {
    encoding: 'utf8',
  }
) {
  const result = await readFileAsync(findPath(filePath, options), options);
  return result.toString();
}

/**
 * Reads JSON from a file.
 * @param filePath Path to the JSON file.
 */
export async function parseJsonFile<T = any>(
  filePath: string,
  options: ReadFileOptions = {
    encoding: 'utf8',
  }
) {
  const contents = await readFile(filePath, options);
  return JSON.parse(contents) as T;
}

/**
 * Reads and parses a YML file.
 * @param yamlPath Path to the YML file.
 */
export async function parseYamlFile<T = any>(
  filePath: string,
  options: ReadFileOptions = {
    encoding: 'utf8',
  }
): Promise<T> {
  const contents = await readFile(filePath, options);
  return yaml.load(contents) as T;
}

/**
 * Writes a file.
 * @param exportPath Path to the file to write.
 * @param contents The file contents.
 */
export async function writeFile(
  exportPath: string,
  contents: any,
  options: CommonFsOptions = {}
) {
  const resolvedPath = resolvePath(exportPath, options);
  await writeFileAsync(resolvedPath, contents);
  if (options.debug) {
    options.debug(`created file "${resolvedPath}"`);
  }
}

/**
 * Writes a temporary file.
 * @param contents The file contents.
 */
export async function writeTempFile(contents: any) {
  const tempPath: string = await tmpNameAsync();
  await writeFileAsync(tempPath, contents);
  return tempPath;
}

/**
 * Writes data encoded as JSON to a file.
 * @param filePath Path to the file to write.
 * @param data The data to encode to JSON and write to the file.
 */
export async function writeJsonFile(
  filePath: string,
  data: any,
  options: CommonFsOptions = {}
) {
  const json = JSON.stringify(data);
  const resolvedPath = resolvePath(filePath, options);
  await writeFileAsync(resolvedPath, json);
  if (options.debug) {
    options.debug(`exported JSON to "${resolvedPath}" (${json.length}b)`);
  }
  return resolvedPath;
}

export interface JsonEncoderOptions extends CommonFsOptions {
  /**
   * If true, enables stable sorting of object keys.
   */
  stable?: boolean;
}

/**
 * Writes data encoded as pretty JSON to a file.
 * @param filePath Path to the file to write.
 * @param data The data to encode to JSON and write to the file.
 */
export async function writePrettyJsonFile(
  filePath: string,
  data: any,
  options: JsonEncoderOptions = {
    stable: false,
  }
) {
  const json = encodeAsPrettyJson(data, options.stable);
  const resolvedPath = resolvePath(filePath, options);
  await writeFileAsync(resolvedPath, json);
  if (options.debug) {
    options.debug(
      `exported pretty JSON to "${resolvedPath}" (${json.length}b)`
    );
  }
  return resolvedPath;
}

/**
 * Writes data encoded as YAML to a file.
 * @param filePath Path to the file to write.
 * @param data The data to encode to YAML and write to the file.
 */
export async function writeYamlFile(
  filePath: string,
  data: any,
  options: CommonFsOptions = {}
) {
  const resolvedPath = resolvePath(filePath, options);
  const contents = yaml.dump(data, {
    sortKeys: true,
  });
  await writeFileAsync(resolvedPath, contents);
  if (options.debug) {
    options.debug(`exported YAML to "${resolvedPath}"`);
  }
  return contents;
}

/**
 * Deletes a single file.
 * @param filePath Path to the file to be deleted.
 */
export async function removeFile(
  filePath: string,
  options: CommonFsOptions = {}
) {
  const resolvedPath = resolvePath(filePath, options);
  await unlinkAsync(resolvedPath);
}

/**
 * Lists all directory items that match the predicate. Their full path will be
 * resolved.
 * @param directoryPath Path to the parent folder containing the files.
 * @param predicate Called for each file or directory name. Only items will be
 * returned where the predicate returns `true`.
 */
export async function resolveDirectoryContents(
  directoryPath: string,
  options: CommonFsOptionsWithPredicate = {}
) {
  const resolvedParent = resolvePath(directoryPath, options);
  const files = await readdirAsync(resolvedParent);
  return files
    .filter(options.predicate ? options.predicate : () => true)
    .map(fileName => path.resolve(resolvedParent, fileName));
}

/**
 * Deletes all files returned by `resolveDirectoryContents()`.
 */
export async function removeFiles(
  parentPath: string,
  options: CommonFsOptionsWithPredicate = {}
) {
  const files = await resolveDirectoryContents(parentPath, options);
  return Promise.all(
    files.map(async filePath => {
      await unlinkAsync(filePath);
    })
  );
}

/**
 * Encodes data as a prettified JSON string.
 * @param data The data to encode to JSON.
 * @param stable If true, enables stable sorting of object keys.
 */
function encodeAsPrettyJson(data: any, stable = false) {
  if (stable) {
    return stringify(data, { space: 2 });
  }
  return JSON.stringify(data, undefined, 2);
}
