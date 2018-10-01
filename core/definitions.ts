import { parseYamlFile } from './fs';

export interface ImportDefinition {
  import: string;
}

export interface PortDefinitions {
  [id: string]: string;
}

export type NodeList = Array<NodeDefinition>;

export interface NodeConfiguration {
  id: string;
  description?: string;
  in?: PortDefinitions;
  out?: PortDefinitions;
}

export interface NodeDefinition {
  [nodeType: string]: NodeConfiguration;
}

export interface GroupDefinition {
  description?: string;
  nodes: NodeList;
}

export interface CocoonDefinitions {
  [category: string]: GroupDefinition;
}

export function loadDefinitionFromFile(definitionPath: string) {
  return parseYamlFile<CocoonDefinitions>(definitionPath);
}
