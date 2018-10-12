import { parseYamlFile } from './fs';

export const debug = require('debug')('cocoon:definitions');

export interface ImportDefinition {
  import: string;
}

export interface PortDefinitions {
  [id: string]: string;
}

export interface NodeDefinition {
  id: string;
  description?: string;
  config?: any;
  x?: number;
  y?: number;
  in?: PortDefinitions;
}

export interface GroupDefinition {
  description?: string;
  nodes: Array<{ [nodeType: string]: NodeDefinition }>;
}

export interface CocoonDefinitions {
  [category: string]: GroupDefinition;
}

export function loadDefinitionFromFile(definitionPath: string) {
  debug(`parsing Cocoon definition file at "${definitionPath}"`);
  return parseYamlFile<CocoonDefinitions>(definitionPath);
}

export function parsePortDefinition(definition: string) {
  const match = definition.match(/(?<id>[^/]+)\/(?<port>.+)/);
  if (!match || match.groups === undefined) {
    return null;
  }
  return { id: match.groups.id, port: match.groups.port };
}
