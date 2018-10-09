import { CocoonDefinitions } from './definitions';
import { createGraph } from './graph';

export function run(definitions: CocoonDefinitions) {
  const nodes = createGraph(definitions);
}
