import { CocoonNode, CocoonView } from '@cocoon/types';
import _ from 'lodash';

export interface CocoonRegistry {
  nodes: {
    [nodeType: string]: CocoonNode | undefined;
  };

  views: {
    [viewType: string]: CocoonView | undefined;
  };
}

export function createEmptyRegistry(): CocoonRegistry {
  return {
    nodes: {},
    views: {},
  };
}

export function requireCocoonNode(
  registry: CocoonRegistry,
  type: string
): CocoonNode {
  const node = registry.nodes[type];
  if (!node) {
    throw new Error(`node type does not exist: ${type}`);
  }
  return node;
}

export function requireCocoonView(
  registry: CocoonRegistry,
  type: string
): CocoonView {
  const view = registry.views[type];
  if (!view) {
    throw new Error(`view type does not exist: ${type}`);
  }
  return view;
}

export function registerCocoonNode(
  registry: CocoonRegistry,
  type: string,
  node: CocoonNode
) {
  registry.nodes[type] = node;
}

export function registerCocoonView(
  registry: CocoonRegistry,
  type: string,
  view: CocoonView
) {
  registry.views[type] = view;
}

export function listNodeTypes(registry: CocoonRegistry) {
  return Object.keys(registry.nodes);
}

export function listViewTypes(registry: CocoonRegistry) {
  return Object.keys(registry.views);
}

export function listNodes(registry: CocoonRegistry) {
  return listNodeTypes(registry).map(type => ({
    type,
    value: registry.nodes[type]!,
  }));
}

export function listViews(registry: CocoonRegistry) {
  return listViewTypes(registry).map(type => ({
    type,
    value: registry.views[type]!,
  }));
}

export function listCategories(registry: CocoonRegistry) {
  return _.sortBy(
    _.uniq(listNodes(registry).map(n => (n ? n.value.category : undefined)))
  );
}
