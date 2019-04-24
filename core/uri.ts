import got from 'got';
import yaml from 'js-yaml';
import _ from 'lodash';
import {
  checkPath,
  CommonFsOptions,
  parseJsonFile,
  parseYamlFile,
  readFile,
} from './fs';

type CommonUriOptions = CommonFsOptions;

export async function resolveUri(uri: string, options?: CommonUriOptions) {
  if (uri.match(/[a-z]+:\/\//)) {
    return new URL(uri);
  }
  const resolvedPath = checkPath(uri, options);
  if (resolvedPath) {
    return new URL(`file://${resolvedPath}`);
  }
  throw new Error(`failed to resolve URI "${uri}"`);
}

export async function resolveYaml<T>(
  configOrUri: string | T,
  options?: CommonUriOptions
) {
  return _.isString(configOrUri)
    ? parseYamlFileFromUri<T>(configOrUri, options)
    : configOrUri;
}

export async function readFileFromUri(uri: string, options?: CommonUriOptions) {
  const url = await resolveUri(uri, options);
  if (url.protocol.startsWith('file')) {
    return readFile(decodeURIComponent(url.pathname));
  } else {
    const { body } = await got(url.href);
    return body;
  }
}

export async function parseJsonFileFromUri<T = any>(
  uri: string,
  options?: CommonUriOptions
) {
  const url = await resolveUri(uri, options);
  if (url.protocol.startsWith('file')) {
    return parseJsonFile<T>(decodeURIComponent(url.pathname));
  } else {
    const { body } = await got(url.href, { json: true });
    return body as T;
  }
}

export async function parseYamlFileFromUri<T = any>(
  uri: string,
  options?: CommonUriOptions
) {
  const url = await resolveUri(uri, options);
  if (url.protocol.startsWith('file')) {
    return parseYamlFile<T>(decodeURIComponent(url.pathname));
  } else {
    const { body } = await got(url.href);
    return yaml.load(body) as T;
  }
}
