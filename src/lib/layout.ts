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
 *
 * Collapse: a group path in the `collapsed` set folds to a single box that
 * renders a *minimap of its own DAG*. Its member leaves (and any nested
 * subgroups) drop out of the main layout; in their place the box's members and
 * their intra-group edges are laid out by `miniLayout`, and the box is sized to
 * that result (so it matches what `CocoonGroup` renders — no measure
 * round-trip). Edges crossing the group boundary reroute onto the box (see
 * `collapseEdges`); edges internal to the collapsed group vanish.
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

// --- collapse topology -----------------------------------------------------

/** The shallowest prefix of `path` that is collapsed, else undefined. */
const collapsedAncestor = (
  path: string | undefined,
  collapsed: Set<string>
): string | undefined => {
  if (!path) return undefined;
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join('/');
    if (collapsed.has(p)) return p;
  }
  return undefined;
};

/**
 * Map each leaf node id that lives under a collapsed group to the *shallowest*
 * collapsed ancestor it folds into. A leaf not under any collapsed group is
 * absent. Shared by `layout` (dagre) and `collapseEdges` (display edges) so
 * both reroute identically.
 */
export function collapseRootMap(
  ns: CocoonFlowNode[],
  collapsed: Set<string>
): Map<string, string> {
  const m = new Map<string, string>();
  if (!collapsed.size) return m;
  for (const n of ns) {
    const r = collapsedAncestor(n.data.group, collapsed);
    if (r) m.set(n.id, r);
  }
  return m;
}

/** Reroute one edge endpoint through the collapse map: a node folded into a
 *  collapsed group becomes that group's box id, else unchanged. The single
 *  kernel behind both the dagre reroute in `layout` and `collapseEdges`, so the
 *  two stay consistent. */
const foldEndpoint = (id: string, collapseRootOf: Map<string, string>) =>
  collapseRootOf.has(id) ? GROUP_PREFIX + collapseRootOf.get(id)! : id;

/**
 * Reroute the display edges through the collapse map: an endpoint that folds
 * into a collapsed group is replaced by the group box (handle cleared so the
 * edge attaches to the box's single side handle); edges internal to one
 * collapsed group are dropped; duplicates that result from the fold collapse
 * to one. Identity passthrough when nothing is collapsed.
 */
export function collapseEdges(
  base: Edge[],
  collapseRootOf: Map<string, string>
): Edge[] {
  if (!collapseRootOf.size) return base;
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const e of base) {
    const source = foldEndpoint(e.source, collapseRootOf);
    const target = foldEndpoint(e.target, collapseRootOf);
    if (source === e.source && target === e.target) {
      out.push(e); // neither endpoint folded
      continue;
    }
    if (source === target) continue; // internal to a collapsed group
    // A folded endpoint loses its port handle (the box has one side handle).
    const sourceHandle = source === e.source ? e.sourceHandle : null;
    const targetHandle = target === e.target ? e.targetHandle : null;
    const key = `${source}|${sourceHandle ?? ''}->${target}|${targetHandle ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, source, target, sourceHandle, targetHandle });
  }
  return out;
}

// --- collapsed-group geometry ----------------------------------------------
// A collapsed group renders a *minimap of its own DAG*: members laid out LR as
// small status squares wired by their intra-group edges. The title strip +
// padding frame it; mirror these in CocoonGroup.svelte's `.collapsed`.
const COLLAPSE = {
  padX: 14,
  padTop: 30, // top padding + title strip + gap above the mini-graph
  padBottom: 14,
  // Floor the width near a regular node's so a collapsed group reads as a peer
  // box, not a stray chip — and so the title fits without truncating.
  minWidth: 250,
};
// The inner mini-DAG: tiny nodes, tight spacing, scaled down past a cap so a
// big group stays a thumbnail rather than ballooning the box.
const MINI = {
  node: 14,
  nodesep: 10,
  ranksep: 26,
  maxW: 260,
  maxH: 150,
};

export interface MiniGraph {
  /** Member node top-left positions, parallel to the group's `memberIds`. */
  pos: { x: number; y: number }[];
  /** Intra-group edges as index pairs into `memberIds`. */
  edges: [number, number][];
  /** Content box (node squares + edges), already scaled. */
  w: number;
  h: number;
  /** Scaled square side. */
  node: number;
}

/** Lay the members out as a compact LR DAG using only intra-group edges. */
function miniLayout(
  ids: string[],
  intra: Array<[string, string]>
): Omit<MiniGraph, 'edges'> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    nodesep: MINI.nodesep,
    ranksep: MINI.ranksep,
    marginx: 0,
    marginy: 0,
  });
  for (const id of ids) g.setNode(id, { width: MINI.node, height: MINI.node });
  for (const [s, t] of intra) g.setEdge(s, t);
  dagre.layout(g);

  const tl = ids.map(id => {
    const c = g.node(id);
    return { x: c.x - MINI.node / 2, y: c.y - MINI.node / 2 };
  });
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of tl) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + MINI.node);
    maxY = Math.max(maxY, p.y + MINI.node);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = MINI.node;
  }
  const rawW = maxX - minX || MINI.node;
  const rawH = maxY - minY || MINI.node;
  const scale = Math.min(1, MINI.maxW / rawW, MINI.maxH / rawH);
  return {
    pos: tl.map(p => ({ x: (p.x - minX) * scale, y: (p.y - minY) * scale })),
    w: rawW * scale,
    h: rawH * scale,
    node: MINI.node * scale,
  };
}

const collapsedBoxSize = (mini: MiniGraph) => ({
  width: Math.max(COLLAPSE.minWidth, COLLAPSE.padX * 2 + mini.w),
  height: COLLAPSE.padTop + COLLAPSE.padBottom + mini.h,
});

// --- node synthesis --------------------------------------------------------

/**
 * Build the synthetic Svelte Flow node for a group box. Not a real Cocoon
 * node, so it carries empty `CocoonNodeData` fields alongside the collapse
 * extras `CocoonGroup` reads — this factory is the one place that asserts the
 * shape across that gap.
 */
function makeGroupNode(opts: {
  path: string;
  box: { width: number; height: number };
  parentId?: string;
  x: number;
  y: number;
  collapsed: boolean;
  memberIds: string[];
  mini?: MiniGraph;
}): CocoonFlowNode {
  const { path, box, parentId, x, y, collapsed, memberIds, mini } = opts;
  return {
    id: GROUP_PREFIX + path,
    type: 'group',
    position: { x, y },
    parentId,
    width: box.width,
    height: box.height,
    style: `width:${box.width}px;height:${box.height}px;`,
    draggable: true,
    selectable: true,
    connectable: false,
    deletable: false,
    data: {
      label: path.split('/').at(-1)!,
      path,
      collapsed,
      memberIds,
      mini,
      nodeType: '',
      params: {},
      inPorts: [],
      outPorts: [],
    },
  } as unknown as CocoonFlowNode;
}

export function layout(
  ns: CocoonFlowNode[],
  es: Edge[],
  collapsed: Set<string> = new Set()
): CocoonFlowNode[] {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96 });

  const groupPaths = new Set<string>();
  for (const n of ns)
    if (n.data.group)
      for (const p of ancestorPaths(n.data.group)) groupPaths.add(p);

  // Partition the group paths once. A path is *suppressed* when it sits
  // strictly inside a collapsed group (folded away, never emitted); a
  // *collapsed root* is itself collapsed but not suppressed (the box we draw);
  // everything else is a normal expanded cluster Dagre sizes from its children.
  const suppressed = new Set<string>();
  const collapsedRoots = new Set<string>();
  for (const p of groupPaths) {
    const anc = collapsedAncestor(p, collapsed);
    if (anc !== undefined && anc !== p) suppressed.add(p);
    else if (collapsed.has(p)) collapsedRoots.add(p);
  }
  const collapseRootOf = collapseRootMap(ns, collapsed);

  // Member leaves per collapsed root (file order) — the order `memberIds`,
  // `pos`, and the App-injected `statuses` all share.
  const membersOf = new Map<string, string[]>();
  for (const [id, root] of collapseRootOf) {
    const arr = membersOf.get(root);
    if (arr) arr.push(id);
    else membersOf.set(root, [id]);
  }

  // Pre-lay each collapsed group's internal DAG (members + the edges between
  // them) so we can both size the box and hand the geometry to the renderer.
  const miniOf = new Map<string, MiniGraph>();
  for (const p of collapsedRoots) {
    const ids = membersOf.get(p) ?? [];
    const idx = new Map(ids.map((id, i) => [id, i]));
    const intra = es.filter(
      e =>
        collapseRootOf.get(e.source) === p && collapseRootOf.get(e.target) === p
    );
    const m = miniLayout(
      ids,
      intra.map(e => [e.source, e.target] as [string, string])
    );
    miniOf.set(p, {
      ...m,
      edges: intra.map(e => [idx.get(e.source)!, idx.get(e.target)!]),
    });
  }

  for (const p of groupPaths) {
    if (suppressed.has(p)) continue;
    if (collapsedRoots.has(p))
      g.setNode(GROUP_PREFIX + p, collapsedBoxSize(miniOf.get(p)!));
    else g.setNode(GROUP_PREFIX + p, {}); // compound cluster, dagre sizes it
  }
  for (const n of ns) {
    if (collapseRootOf.has(n.id)) continue; // folded into a collapsed box
    g.setNode(n.id, nodeSize(n));
  }

  for (const n of ns) {
    if (collapseRootOf.has(n.id)) continue;
    if (n.data.group) g.setParent(n.id, GROUP_PREFIX + n.data.group);
  }
  for (const p of groupPaths) {
    if (suppressed.has(p)) continue;
    const parts = p.split('/');
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join('/');
      if (!suppressed.has(parent))
        g.setParent(GROUP_PREFIX + p, GROUP_PREFIX + parent);
    }
  }

  for (const e of es) {
    const s = foldEndpoint(e.source, collapseRootOf);
    const t = foldEndpoint(e.target, collapseRootOf);
    if (s !== t) g.setEdge(s, t);
  }
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
    .filter(p => !suppressed.has(p))
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .map(path => {
      const { parentId, x, y } = placed(GROUP_PREFIX + path);
      const isCollapsed = collapsedRoots.has(path);
      const c = g.node(GROUP_PREFIX + path);
      return makeGroupNode({
        path,
        box: { width: c.width, height: c.height },
        parentId,
        x,
        y,
        collapsed: isCollapsed,
        memberIds: isCollapsed ? (membersOf.get(path) ?? []) : [],
        mini: isCollapsed ? miniOf.get(path) : undefined,
      });
    });

  const leafNodes = ns
    .filter(n => !collapseRootOf.has(n.id))
    .map(n => {
      const { parentId, x, y } = placed(n.id);
      return { ...n, position: { x, y }, parentId };
    });

  return [...groupNodes, ...leafNodes];
}
