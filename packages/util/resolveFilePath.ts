import path from 'path';

/**
 * Resolves an absolute file path, similar to node's `path.resolve()`, with the
 * difference that it expands `~` into the user's home directory and can resolve
 * relative to a specified path.
 * @param filePath Relative or absolute path to the file or directory.
 * @node
 */
export default function(filePath: string, relativeTo?: string) {
  return relativeTo
    ? path.resolve(expandPath(relativeTo), expandPath(filePath))
    : path.resolve(expandPath(filePath));
}

/**
 * Expands `~` into the user's home directory.
 */
function expandPath(filePath: string) {
  if (filePath[0] === '~') {
    return path.join(process.env.HOME || '', filePath.slice(1));
  }
  return filePath;
}
