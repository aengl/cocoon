import _ from 'lodash';
import { parseYamlFile } from './fs';

const debug = require('debug')('cocoon:definitions');

export interface ImportDefinition {
  import: string;
}

export interface PortDefinitions {
  [id: string]: string;
}

export interface NodeConfiguration {
  id: string;
  description?: string;
  x?: number;
  y?: number;
  in?: PortDefinitions;
  out?: PortDefinitions;
}

export interface NodeDefinition {
  [nodeType: string]: NodeConfiguration;
}

export interface GroupDefinition {
  description?: string;
  nodes: NodeDefinition[];
}

export interface CocoonDefinitions {
  [category: string]: GroupDefinition;
}

export interface CocoonNode extends NodeConfiguration {
  type: string;
  group: string;
  edges: CocoonEdge[];
}

export interface CocoonEdge {
  from: CocoonNode;
  fromPort: string;
  to: CocoonNode;
  toPort: string;
}

export function loadDefinitionFromFile(definitionPath: string) {
  debug(`parsing Cocoon definition file at "${definitionPath}"`);
  return parseYamlFile<CocoonDefinitions>(definitionPath);
}

export function listNodesInDefinitions(
  definitions: CocoonDefinitions
): CocoonNode[] {
  debug(`creating tree nodes & edges from definitions`);

  // Create a flat list of nodes
  const groups = Object.keys(definitions);
  const nodes = _.flatten(
    groups.map(group => {
      return definitions[group].nodes.map(node => {
        const type = Object.keys(node)[0];
        return {
          edges: [] as CocoonEdge[],
          group,
          type,
          ...node[type],
        };
      });
    })
  );

  // Map all nodes
  const nodeMap = nodes.reduce((all, node) => {
    all[node.id] = node;
    return all;
  }, {});

  // Assign edges to nodes
  nodes.forEach(node => {
    const nodeOut = node.out;
    if (nodeOut !== undefined) {
      node.edges = Object.keys(nodeOut).map(key => {
        const { id, port } = parsePortDefinition(nodeOut[key]);
        return {
          from: node,
          fromPort: key,
          to: nodeMap[id],
          toPort: port,
        };
      });
    }
  });

  debug(nodes);

  return nodes;
}

function parsePortDefinition(definition: string) {
  const match = definition.match(/(?<id>[^/]+)\/(?<port>.+)/);
  if (!match) {
    throw new Error(`Invalid port definition: "${definition}"`);
  }
  const groups: any = match.groups;
  return { id: groups.id, port: groups.port };
}
