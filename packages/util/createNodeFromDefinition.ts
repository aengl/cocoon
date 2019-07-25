import { CocoonNodeDefinition, CocoonRegistry, GraphNode } from '@cocoon/types';
import parseViewString from '@cocoon/util/parseViewString';
import requireCocoonNode from '@cocoon/util/requireCocoonNode';
import requireCocoonView from '@cocoon/util/requireCocoonView';

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
    node.view = viewInfo ? viewInfo.type : definition.view;
    const view = requireCocoonView(registry, node.view);
    node.viewPort = viewInfo
      ? viewInfo.port
      : // Fall back to default port
        view.defaultPort ||
        node.cocoonNode!.defaultPort || {
          incoming: false,
          name: 'data',
        };
  }
  return node;
}
