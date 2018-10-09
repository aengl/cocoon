import { CocoonDefinitions, loadDefinitionFromFile } from './definitions';
import { createGraph, findPath } from './graph';

const debug = require('debug')('cocoon:index');

export function open(definitionsPath: string) {
  const definitions: CocoonDefinitions = loadDefinitionFromFile(
    definitionsPath
  );
  const graph = createGraph(definitions);
  global.definitions = definitions;
  global.graph = graph;
}

export function run(nodeId: string) {
  debug(`evaluating node with id "${nodeId}"`);
  const path = findPath(global.graph, nodeId);
  debug(path);
}
