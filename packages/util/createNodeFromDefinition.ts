import { CocoonNodeDefinition, CocoonRegistry, GraphNode } from '@cocoon/types';
import parseViewString from '@cocoon/util/parseViewString';
import requireCocoonNode from '@cocoon/util/requireCocoonNode';

export default function(
  id: string,
  definition: CocoonNodeDefinition,
  registry: CocoonRegistry
) {
  if (id.indexOf('/') >= 0) {
    throw new Error(`disallowed symbol "/" in node id "${id}"`);
  }
  const node: GraphNode = {
    // TODO: we could allow unresolved types at this stage, as long as an
    // unresolved node isn't processed. It just needs to be displayed in a
    // special way.
    cocoonNode: requireCocoonNode(registry, definition.type),
    definition,
    edgesIn: [],
    edgesOut: [],
    id,
    state: {},
  };
  // Parse and assign view definition
  if (definition.view !== undefined) {
    const viewInfo = parseViewString(definition.view);
    node.view = viewInfo === undefined ? definition.view : viewInfo.type;
    node.viewPort = viewInfo === undefined ? undefined : viewInfo.port;
  }
  return node;
}
