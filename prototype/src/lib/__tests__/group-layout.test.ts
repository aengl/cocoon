import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dagre from '@dagrejs/dagre';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { CocoonFile } from '../cocoon-file';
import { loadCocoonFile, serializeCocoonFile } from '../definition';

/**
 * SPIKE — does Svelte Flow's group/sub-flow model play nicely with our
 * Dagre auto-layout? (Investigation for the `editor.group` YAML extension.)
 *
 * The two coordinate models we have to reconcile:
 *
 *  - Dagre compound layout (`new Graph({ compound: true })` +
 *    `g.setParent(child, cluster)`): after `layout()` every node — leaves
 *    AND cluster/parent nodes — has an *absolute* centre `(x, y)` plus
 *    `width/height`; a cluster's box encloses its children.
 *  - Svelte Flow groups: a parent node (`type:'group'`, sized via `style`)
 *    plus children carrying `parentId`. A child's `position` is *relative
 *    to its direct parent's top-left*, and xyflow requires every parent to
 *    appear before its children in the nodes array.
 *
 * So the bridge is purely arithmetic: convert each dagre absolute top-left
 * into a position relative to the direct parent, synthesise a group node
 * per distinct `editor.group` path, and emit parents-before-children.
 * `editor.group` is a slash path ("Crawl/Amazon") so groups can nest,
 * mirroring how `cocoon://` is itself a string grammar.
 *
 * This test is the reference implementation of that bridge and asserts the
 * invariants that make it "play nicely": clusters enclose their members,
 * child coords are parent-relative, nesting works, ungrouped nodes stay
 * absolute, and the emit order is parent-before-child.
 */

interface SpikeNode {
  id: string;
  /** mirrors a YAML `editor.group` slash-path; undefined = top-level */
  group?: string;
  w?: number;
  h?: number;
}
interface SpikeEdge {
  source: string;
  target: string;
}

interface LaidOutNode {
  id: string;
  isGroup: boolean;
  parentId?: string;
  /** xyflow semantics: relative to parent top-left, else absolute */
  position: { x: number; y: number };
  width: number;
  height: number;
}

const groupId = (path: string) => `__group__/${path}`;

/** "A/B/C" -> ["A", "A/B", "A/B/C"] (every ancestor path, outer first). */
function ancestorPaths(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** The bridge under test. */
function layoutCompound(
  nodes: SpikeNode[],
  edges: SpikeEdge[]
): LaidOutNode[] {
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));

  // Every distinct group path (incl. intermediate ancestors) is a cluster.
  const groupPaths = new Set<string>();
  for (const n of nodes)
    if (n.group) for (const p of ancestorPaths(n.group)) groupPaths.add(p);

  // Cluster nodes: empty box, dagre computes size to enclose children.
  for (const p of groupPaths) g.setNode(groupId(p), {});
  // Leaf nodes carry a real size.
  for (const n of nodes)
    g.setNode(n.id, { width: n.w ?? 200, height: n.h ?? 70 });

  // Parent wiring: leaf -> deepest group; group -> its parent group.
  for (const n of nodes)
    if (n.group) g.setParent(n.id, groupId(n.group));
  for (const p of groupPaths) {
    const parts = p.split('/');
    if (parts.length > 1)
      g.setParent(groupId(p), groupId(parts.slice(0, -1).join('/')));
  }

  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const absTL = (id: string) => {
    const c = g.node(id);
    return { x: c.x - c.width / 2, y: c.y - c.height / 2 };
  };
  const directParentId = (id: string): string | undefined => {
    const p = g.parent(id);
    return p ?? undefined; // dagre returns the cluster id we set, or undefined
  };

  const toLaidOut = (id: string, isGroup: boolean): LaidOutNode => {
    const c = g.node(id);
    const me = absTL(id);
    const pid = directParentId(id);
    const off = pid ? absTL(pid) : { x: 0, y: 0 };
    return {
      id,
      isGroup,
      parentId: pid,
      position: { x: me.x - off.x, y: me.y - off.y },
      width: c.width,
      height: c.height,
    };
  };

  // Emit groups first (shallow paths before deep — guarantees a parent is
  // always emitted before any child), then the leaf nodes.
  const groupNodes = [...groupPaths]
    .sort((a, b) => a.split('/').length - b.split('/').length)
    .map(p => toLaidOut(groupId(p), true));
  const leafNodes = nodes.map(n => toLaidOut(n.id, false));
  return [...groupNodes, ...leafNodes];
}

const enclosedBy = (child: LaidOutNode, group: LaidOutNode) =>
  child.position.x >= -0.01 &&
  child.position.y >= -0.01 &&
  child.position.x + child.width <= group.width + 0.01 &&
  child.position.y + child.height <= group.height + 0.01;

describe('Svelte Flow groups ↔ Dagre compound layout', () => {
  // Two flat groups + one ungrouped node, edges crossing a group boundary —
  // the shape of a real Cocoon flow (Crawl* cluster -> Annotate* cluster).
  const nodes: SpikeNode[] = [
    { id: 'CrawlAmazon', group: 'Crawl' },
    { id: 'CrawlBGG', group: 'Crawl' },
    { id: 'Annotate', group: 'Annotate' },
    { id: 'AnnotateManual', group: 'Annotate' },
    { id: 'Publish' }, // ungrouped, top-level
  ];
  const edges: SpikeEdge[] = [
    { source: 'CrawlAmazon', target: 'Annotate' },
    { source: 'CrawlBGG', target: 'Annotate' },
    { source: 'Annotate', target: 'AnnotateManual' },
    { source: 'AnnotateManual', target: 'Publish' },
  ];

  const out = layoutCompound(nodes, edges);
  const byId = Object.fromEntries(out.map(n => [n.id, n]));

  it('synthesises one group node per distinct editor.group path', () => {
    expect(out.filter(n => n.isGroup).map(n => n.id).sort()).toEqual([
      groupId('Annotate'),
      groupId('Crawl'),
    ]);
  });

  it('clusters get a real size that encloses their members', () => {
    const crawl = byId[groupId('Crawl')];
    expect(crawl.width).toBeGreaterThan(0);
    expect(crawl.height).toBeGreaterThan(0);
    expect(enclosedBy(byId['CrawlAmazon'], crawl)).toBe(true);
    expect(enclosedBy(byId['CrawlBGG'], crawl)).toBe(true);
  });

  it('grouped children carry parentId + parent-relative coords', () => {
    expect(byId['CrawlAmazon'].parentId).toBe(groupId('Crawl'));
    // relative, so small numbers near the group origin — NOT global coords
    expect(byId['CrawlAmazon'].position.x).toBeLessThan(
      byId[groupId('Crawl')].width
    );
  });

  it('ungrouped nodes stay top-level with absolute coords', () => {
    expect(byId['Publish'].parentId).toBeUndefined();
  });

  it('emits every parent before its children (xyflow requirement)', () => {
    const seen = new Set<string>();
    for (const n of out) {
      if (n.parentId) expect(seen.has(n.parentId)).toBe(true);
      seen.add(n.id);
    }
  });

  it('prints the resolved geometry (see how it behaves)', () => {
    const fmt = (n: LaidOutNode) =>
      `${n.isGroup ? '▸' : ' '} ${n.id.padEnd(22)} ` +
      `parent=${(n.parentId ?? '—').padEnd(18)} ` +
      `pos=(${n.position.x.toFixed(0)},${n.position.y.toFixed(0)}) ` +
      `${n.width.toFixed(0)}x${n.height.toFixed(0)}`;
    console.log('\n[flat groups]\n' + out.map(fmt).join('\n'));
    expect(out.length).toBe(7); // 2 groups + 5 leaves
  });
});

describe('nested groups (editor.group = "A/B")', () => {
  const nodes: SpikeNode[] = [
    { id: 'CrawlAmazonDe', group: 'Crawl/Amazon' },
    { id: 'CrawlAmazonEn', group: 'Crawl/Amazon' },
    { id: 'CrawlBGG', group: 'Crawl' },
    { id: 'Annotate' },
  ];
  const edges: SpikeEdge[] = [
    { source: 'CrawlAmazonDe', target: 'Annotate' },
    { source: 'CrawlAmazonEn', target: 'Annotate' },
    { source: 'CrawlBGG', target: 'Annotate' },
  ];
  const out = layoutCompound(nodes, edges);
  const byId = Object.fromEntries(out.map(n => [n.id, n]));

  it('creates both the outer and the intermediate cluster', () => {
    expect(out.some(n => n.id === groupId('Crawl'))).toBe(true);
    expect(out.some(n => n.id === groupId('Crawl/Amazon'))).toBe(true);
  });

  it('the inner cluster is itself a child of the outer cluster', () => {
    expect(byId[groupId('Crawl/Amazon')].parentId).toBe(groupId('Crawl'));
  });

  it('leaves nest under the deepest cluster', () => {
    expect(byId['CrawlAmazonDe'].parentId).toBe(groupId('Crawl/Amazon'));
    expect(byId['CrawlBGG'].parentId).toBe(groupId('Crawl'));
  });

  it('inner cluster fits inside the outer cluster', () => {
    expect(enclosedBy(byId[groupId('Crawl/Amazon')], byId[groupId('Crawl')]))
      .toBe(true);
  });

  it('still emits parents before children', () => {
    const seen = new Set<string>();
    for (const n of out) {
      if (n.parentId) expect(seen.has(n.parentId)).toBe(true);
      seen.add(n.id);
    }
  });

  it('prints the nested geometry', () => {
    const fmt = (n: LaidOutNode) =>
      `${n.isGroup ? '▸' : ' '} ${n.id.padEnd(24)} ` +
      `parent=${(n.parentId ?? '—').padEnd(20)} ` +
      `pos=(${n.position.x.toFixed(0)},${n.position.y.toFixed(0)}) ` +
      `${n.width.toFixed(0)}x${n.height.toFixed(0)}`;
    console.log('\n[nested groups]\n' + out.map(fmt).join('\n'));
  });
});

// Integration: the real loader/serializer over the shipped demo fixture.
// `editor.group` must reach CocoonNodeData and survive round-trip verbatim
// (the serializer owns only `in:` + `editor.col/row` — group is in the
// "everything else passes through" bucket, so this needs zero serializer
// change; the test locks that).
describe('editor.group ↔ real loader / lossless round-trip', () => {
  const raw = readFileSync(
    fileURLToPath(
      new URL('../../../../examples/groups/cocoon.yml', import.meta.url)
    ),
    'utf8'
  );
  const original = parse(raw) as CocoonFile;

  it('loader surfaces editor.group on CocoonNodeData', () => {
    const { nodes } = loadCocoonFile(raw);
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
    expect(byId['CrawlAmazonDe'].data.group).toBe('Crawl/Amazon');
    expect(byId['CrawlBGG'].data.group).toBe('Crawl');
    expect(byId['Annotate'].data.group).toBe('Annotate');
    expect(byId['Publish'].data.group).toBeUndefined();
  });

  it('serialize → re-parse preserves editor.group verbatim', () => {
    const { file, nodes, edges } = loadCocoonFile(raw);
    const round = parse(
      serializeCocoonFile(file, nodes, edges)
    ) as CocoonFile;
    for (const [id, def] of Object.entries(original.nodes)) {
      expect(round.nodes[id].editor?.group, `node ${id}`).toEqual(
        def.editor?.group
      );
    }
  });

  it('grouping does not leak into edges or literal params', () => {
    const { file, nodes, edges } = loadCocoonFile(raw);
    const round = parse(
      serializeCocoonFile(file, nodes, edges)
    ) as CocoonFile;
    // Multi-edge fan-in preserved exactly (order + cocoon:// form).
    expect(round.nodes['Annotate'].in?.data).toEqual([
      'cocoon://CrawlAmazonDe/out/data',
      'cocoon://CrawlAmazonEn/out/data',
      'cocoon://CrawlBGG/out/data',
    ]);
    // Literal param next to an edge survives untouched.
    expect(round.nodes['AnnotateManual'].in?.annotations).toBe(
      './manual.json'
    );
  });
});
