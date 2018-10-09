import { CocoonDefinitions } from './definitions';
import { createGraph, findPath } from './graph';

export function run(definitions: CocoonDefinitions) {
  const nodes = createGraph(definitions);
  const path = findPath(nodes, 'PlotPrices');
}
