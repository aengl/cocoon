import _ from 'lodash';
import { parseYamlFile } from './fs';

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
  edgesIn: CocoonEdge[];
  edgesOut: CocoonEdge[];
}

export interface CocoonEdge {
  from: CocoonNode;
  fromPort: string;
  to: CocoonNode;
  toPort: string;
}

export function loadDefinitionFromFile(definitionPath: string) {
  return parseYamlFile<CocoonDefinitions>(definitionPath);
}

export function listNodesInDefinitions(
  definitions: CocoonDefinitions
): CocoonNode[] {
  const groups = Object.keys(definitions);
  const nodes = _.flatten(
    groups.map(group => {
      const nodes = definitions[group].nodes;
      return nodes.map(node => {
        const type = Object.keys(node)[0];
        return {
          type,
          group,
          edgesIn: [],
          edgesOut: [],
          ...node[type],
        };
      });
    })
  );
  return nodes.map(node => assignEdges(node, nodes));
}

function assignEdges(node: CocoonNode, nodes: CocoonNode[]) {
  return node;
}
