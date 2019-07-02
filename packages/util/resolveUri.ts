import resolveFilePath from '@cocoon/util/resolveFilePath';

/**
 * If given a URL string, it returns a Node.JS URL object. If given a relative
 * or absolute path, it returns the resolved path with a `file://` prefix.
 * @param uri An external url, relative or absolute file path.
 * @param relativeTo Resolve file paths relative to this path.
 */
export default function(uri: string, relativeTo?: string) {
  if (uri.match(/[a-z]+:\/\//)) {
    return new URL(uri);
  }
  const resolvedPath = resolveFilePath(uri, relativeTo);
  return new URL(`file://${resolvedPath}`);
}
