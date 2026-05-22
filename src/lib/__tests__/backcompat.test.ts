import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { CocoonFile } from '../cocoon-file';
import { extractEdges } from '../cocoon-file';
import { parseCocoonUri } from '../cocoon-uri';
import { loadCocoonFile } from '../definition';

// Canonical legacy cocoon.yml shapes, captured under ./fixtures/. There is
// no serialiser to round-trip through (the editor is a viewer, not a
// writer), so back-compat is loader-side: every fixture parses cleanly,
// every cocoon:// reference recovers as an edge, and the loader exposes
// the keys the editor reads (params, group, doc, persist, …).
const EXAMPLES = [
  'simple-api',
  'brushing-and-linking',
  'custom-nodes',
  'interop',
  'imdb',
  'noise',
];

const read = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`./fixtures/${name}/cocoon.yml`, import.meta.url)
    ),
    'utf8'
  );

const edgeKeys = (f: CocoonFile) =>
  extractEdges(f)
    .map(e => `${e.from}.${e.fromPort}->${e.to}.${e.toPort}`)
    .sort();

describe('cocoon-uri grammar (faithful to legacy regexes)', () => {
  it('parses port references and rejects literals', () => {
    expect(parseCocoonUri('cocoon://DataFromAPI/out/data')).toEqual({
      id: 'DataFromAPI',
      port: { incoming: false, name: 'data' },
    });
    expect(parseCocoonUri('x => x.features')).toBeUndefined();
    expect(parseCocoonUri(42)).toBeUndefined();
    expect(parseCocoonUri({ a: 1 })).toBeUndefined();
  });
});

describe('simple-api: exact structural expectations', () => {
  const { nodes, edges } = loadCocoonFile(read('simple-api'));

  it('extracts the dataflow edges', () => {
    expect(
      edges
        .map(e => `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`)
        .sort()
    ).toEqual(
      [
        'DataFromAPI.data->ExtractResults.data',
        'ExtractResults.data->InspectFirstItem.data',
        'ExtractResults.data->MapValues.data',
      ].sort()
    );
  });

  it('exposes literal params, persist, and the legacy editor.actions hand-off', () => {
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    expect(byId.ExtractResults.params.map).toBe('x => x.features');
    expect(byId.DataFromAPI.persist).toBe(true);
    // editor.actions has no UI yet but is surfaced on the loaded node so a
    // future toolbar can render it without another loader change.
    expect(byId.MapValues.actions).toEqual({
      'Open Data Documentation':
        'open https://earthquake.usgs.gov/data/comcat/data-eventterms.php',
    });
  });
});

describe('groups: top-level `group:` is the canonical home', () => {
  it('reads top-level `group:` from the canonical fixture', () => {
    const { nodes } = loadCocoonFile(read('groups'));
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    expect(byId.CrawlAmazonDe.group).toBe('Crawl/Amazon');
    expect(byId.Annotate.group).toBe('Annotate');
    expect(byId.Publish.group).toBeUndefined();
  });

  // Legacy `editor.group` is still accepted on read for older files.
  // There is no writer, so nothing migrates them on disk — the loader is
  // simply tolerant of either location.
  it('reads `editor.group` for back-compat (legacy file shape)', () => {
    const legacy = [
      'nodes:',
      '  A: { type: T, editor: { group: Crawl/Amazon } }',
      '  B: { type: T, editor: { group: Crawl/Amazon, actions: { Run: ./run.sh } } }',
      '  C: { type: T }',
      '',
    ].join('\n');
    const { nodes } = loadCocoonFile(legacy);
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    expect(byId.A.group).toBe('Crawl/Amazon');
    expect(byId.B.group).toBe('Crawl/Amazon');
    expect(byId.B.actions).toEqual({ Run: './run.sh' });
    expect(byId.C.group).toBeUndefined();
  });

  it('a node with both keys defers to the top-level one (no merge surprises)', () => {
    const { nodes } = loadCocoonFile(
      'nodes:\n  X: { type: T, group: top, editor: { group: legacy } }\n'
    );
    expect(nodes[0].data.group).toBe('top');
  });
});

describe.each(EXAMPLES)('%s: loader honours every legacy key', name => {
  const raw = read(name);
  const original = parse(raw) as CocoonFile;

  it('parses without loss of nodes', () => {
    const { nodes } = loadCocoonFile(raw);
    expect(nodes.map(n => n.id).sort()).toEqual(
      Object.keys(original.nodes).sort()
    );
  });

  it('edge count matches the cocoon:// references in the source', () => {
    const refsInSource = (raw.match(/cocoon:\/\//g) ?? []).length;
    expect(edgeKeys(original).length).toBe(refsInSource);
  });

  it('exposes every relevant key the editor renders', () => {
    const { nodes } = loadCocoonFile(raw);
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    for (const [id, def] of Object.entries(original.nodes)) {
      const d = byId[id];
      expect(d, `node ${id} missing`).toBeDefined();
      expect(d.nodeType).toBe(def.type);
      expect(d.doc).toEqual(def['?'] ?? def.description);
      expect(d.persist).toEqual(def.persist);
      // group: top-level wins; legacy editor.group still readable.
      expect(d.group).toEqual(def.group ?? def.editor?.group);
      // editor.actions still surfaces on the loaded node (no UI consumer
      // yet — preserved for when one exists).
      expect(d.actions).toEqual(def.editor?.actions);
    }
  });
});
