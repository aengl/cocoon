import yaml from 'js-yaml';

export interface ImportDefinition {
  import: string;
}

export interface PortDefinitions {
  [id: string]: any;
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

export function parsePortDefinition(definition: string) {
  const match = definition.match(/(?<id>[^/]+)\/(?<port>.+)/);
  if (!match || match.groups === undefined) {
    return null;
  }
  return { id: match.groups.id, port: match.groups.port };
}

export function parseCocoonDefinitions(definitions: string) {
  return yaml.load(definitions) as CocoonDefinitions;
}
