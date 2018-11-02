import yaml from 'js-yaml';
import _ from 'lodash';

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
  [group: string]: GroupDefinition;
}

export function parseCocoonDefinitions(definitions: string) {
  return yaml.load(definitions) as CocoonDefinitions;
}

export function parsePortDefinition(definition: string) {
  const match = definition.match(/(?<id>[^/]+)\/(?<port>.+)/);
  if (!match || match.groups === undefined) {
    return null;
  }
  return { id: match.groups.id, port: match.groups.port };
}

export function getNodesFromDefinitions(definitions: CocoonDefinitions) {
  return _.flatten(
    Object.keys(definitions).map(group =>
      definitions[group].nodes.map(node => {
        const type = Object.keys(node)[0];
        return {
          definition: node[type],
          group,
          type,
        };
      })
    )
  );
}

export function updateNodesInDefinitions(
  definitions: CocoonDefinitions,
  getNodeDefinition: (nodeId: string) => NodeDefinition
) {
  Object.keys(definitions).forEach(group => {
    definitions[group].nodes.map(node => {
      const type = Object.keys(node)[0];
      const definition = node[type];
      node[type] = getNodeDefinition(definition.id);
    });
  });
}
