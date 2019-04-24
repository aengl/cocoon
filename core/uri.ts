import got from 'got';
import { parseJsonFile, CommonFsOptions, checkPath, parseYamlFile } from './fs';
import yaml from 'js-yaml';

type CommonUriOptions = CommonFsOptions;

export async function resolveUri(uri: string, options?: CommonUriOptions) {
  if (uri.match(/[a-z]+:\/\//)) {
    return new URL(uri);
  }
  return new URL(`file://${checkPath(uri, options)}`);
}

export async function parseJsonFileFromUri<T = any>(
  uri: string,
  options?: CommonUriOptions
) {
  const url = await resolveUri(uri, options);
  if (url.protocol.startsWith('file')) {
    return parseJsonFile<T>(url.pathname);
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
    return parseYamlFile<T>(url.pathname);
  } else {
    const { body } = await got(url.href);
    return yaml.load(body) as T;
  }
}
