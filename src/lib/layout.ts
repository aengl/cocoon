import dagre from '@dagrejs/dagre';
import type { Edge } from '@xyflow/svelte';
import type { CocoonFlowNode } from './definition';

/**
 * Dagre-driven auto-layout, including compound groups.
 *
 * A node's `group:` slash-path becomes a Dagre compound cluster plus a
 * synthesised Svelte Flow `type: 'group'` node. Dagre lays everything out in
 * one absolute space; Svelte Flow wants child positions relative to their
 * direct parent and parents emitted before children — both are pure arithmetic
 * here. With no groups this reduces to a plain LR pass.
 *
 * Tall content (long doc, big controls, many params) makes the first pass
 * undershoot, so the caller runs a second pass once Svelte Flow has measured
 * every node.
 */

const GROUP_PREFIX = 'group:';

const ancestorPaths = (path: string) =>
  path.split('/').map((_, i, p) => p.slice(0, i + 1).join('/'));

const nodeSize = (n: CocoonFlowNode) => ({
  width: n.measured?.width ?? 260,
  height:
    n.measured?.height ??
    (n.data.runtime?.controlHtml
      ? 320
      : Object.keys(n.data.params).length
        ? 120
        : 70),
});

export function layout(
  ns: CocoonFlowNode[],
  es: Edge[]
): CocoonFlowNode[] {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96 });

  const groupPaths = new Set<string>();
  for (const n of ns)
    if (n.data.group)
      for (const p of ancestorPaths(n.data.group)) groupPaths.add(p);

  for (const p of groupPaths) g.setNode(GROUP_PREFIX + p, {});
  for (const n of ns) g.setNode(n.id, nodeSize(n));

  for (const n of ns)
    if (n.data.group) g.setParent(n.id, GROUP_PREFIX + n.data.group);
  for (const p of groupPaths) {
    const parts = p.split('/');
    if (parts.length > 1)
      g.setParent(
        GROUP_PREFIX + p,
        GROUP_PREFIX + parts.slice(0, -1).join('/')
      );
  }

  for (const e of es) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const absTL = (id: string) => {
    const c = g.node(id);
    return { x: c.x - c.width / 2, y: c.y - c.height / 2 };
  };
  const placed = (id: string) => {
    const me = absTL(id);
    const pid = g.parent(id) as string | undefined;
    const off = pid ? absTL(pid) : { x: 0, y: 0 };
    return { parentId: pid, x: me.x - off.x, y: me.y - off.y };
  };

  // xyflow requires a parent group to appear before any child (group or leaf).
  const groupNodes: CocoonFlowNode[] = [...groupPaths]
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .map(path => {
      const id = GROUP_PREFIX + path;
      const c = g.node(id);
      const { parentId, x, y } = placed(id);
      return {
        id,
        type: 'group',
        position: { x, y },
        parentId,
        width: c.width,
        height: c.height,
        style: `width:${c.width}px;height:${c.height}px;`,
        draggable: true,
        selectable: true,
        connectable: false,
        deletable: false,
        data: {
          label: path.split('/').at(-1)!,
          path,
          nodeType: '',
          params: {},
          inPorts: [],
          outPorts: [],
        },
      } as unknown as CocoonFlowNode;
    });

  const leafNodes = ns.map(n => {
    const { parentId, x, y } = placed(n.id);
    return { ...n, position: { x, y }, parentId };
  });

  return [...groupNodes, ...leafNodes];
}
