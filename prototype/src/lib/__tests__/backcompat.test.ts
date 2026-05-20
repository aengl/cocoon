import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { CocoonFile } from '../cocoon-file';
import { extractEdges } from '../cocoon-file';
import { parseCocoonUri } from '../cocoon-uri';
import { loadCocoonFile, serializeCocoonFile } from '../definition';

// The canonical legacy fixtures — read straight from the repo's examples/ so
// these tests guard real backwards compatibility, not a copy that can drift.
// `testing` is deliberately excluded: it was dropped (Cocoon is not a test
// runner — see CLAUDE.md). The remaining six are the retained fixtures.
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
      new URL(`../../../../examples/${name}/cocoon.yml`, import.meta.url)
    ),
    'utf8'
  );

/** Literal (non-edge) `in` entries — the part the editor must NOT mutate. */
function literalParams(file: CocoonFile) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [id, def] of Object.entries(file.nodes ?? {})) {
    const params: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(def.in ?? {})) {
      const arr = Array.isArray(raw) ? raw : [raw];
      const lit = arr.filter(v => !parseCocoonUri(v));
      if (lit.length) params[k] = lit.length === 1 ? lit[0] : lit;
    }
    out[id] = params;
  }
  return out;
}

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

  it('preserves literal params', () => {
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    expect(byId.ExtractResults.params.map).toBe('x => x.features');
    expect(byId.DataFromAPI.persist).toBe(true);
    // editor.actions must survive even though col/row no longer do.
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

  // Legacy `editor.group` is still accepted on read for older files (one
  // mercy release of co-evolution). The serializer always migrates it to
  // the top-level form and strips `editor:` if it has nothing else left.
  const legacy = [
    'nodes:',
    '  A: { type: T, editor: { group: Crawl/Amazon } }',
    '  B: { type: T, editor: { group: Crawl/Amazon, actions: { Run: ./run.sh } } }',
    '  C: { type: T }',
    '',
  ].join('\n');

  it('reads `editor.group` for back-compat (legacy file shape)', () => {
    const { nodes } = loadCocoonFile(legacy);
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    expect(byId.A.group).toBe('Crawl/Amazon');
    expect(byId.B.group).toBe('Crawl/Amazon');
    expect(byId.C.group).toBeUndefined();
  });

  it('serializer lifts legacy `editor.group` to top-level + strips the slot', () => {
    const { file, nodes, edges } = loadCocoonFile(legacy);
    const round = parse(serializeCocoonFile(file, nodes, edges)) as CocoonFile;
    // A had only editor.group → editor: dropped entirely after the lift.
    expect(round.nodes.A.group).toBe('Crawl/Amazon');
    expect(round.nodes.A.editor).toBeUndefined();
    // B's editor.actions survives; only editor.group is stripped.
    expect(round.nodes.B.group).toBe('Crawl/Amazon');
    expect(round.nodes.B.editor?.actions).toEqual({ Run: './run.sh' });
    expect(round.nodes.B.editor?.group).toBeUndefined();
    expect(round.nodes.C.group).toBeUndefined();
    expect(round.nodes.C.editor).toBeUndefined();
  });

  it('a node with both keys defers to the top-level one (no merge surprises)', () => {
    const both = 'nodes:\n  X: { type: T, group: top, editor: { group: legacy } }\n';
    const { file, nodes, edges } = loadCocoonFile(both);
    const round = parse(serializeCocoonFile(file, nodes, edges)) as CocoonFile;
    expect(round.nodes.X.group).toBe('top');
    expect(round.nodes.X.editor).toBeUndefined();
  });
});

describe.each(EXAMPLES)('%s: lossless semantic round-trip', name => {
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

  it('serialize → re-parse preserves everything the editor does not own', () => {
    const { file, nodes, edges } = loadCocoonFile(raw);
    const round = parse(
      serializeCocoonFile(file, nodes, edges)
    ) as CocoonFile;

    // Topology preserved.
    expect(edgeKeys(round)).toEqual(edgeKeys(original));
    // Literal params preserved (code strings, nested objects/arrays).
    expect(literalParams(round)).toEqual(literalParams(original));
    // Top-level extras preserved.
    expect(round.env).toEqual(original.env);
    expect(round.description).toEqual(original.description);

    for (const [id, def] of Object.entries(original.nodes)) {
      const r = round.nodes[id];
      expect(r, `node ${id} missing`).toBeDefined();
      expect(r.type).toBe(def.type);
      expect(r['?']).toEqual(def['?']);
      expect(r.description).toEqual(def.description);
      expect(r.persist).toEqual(def.persist);
      expect(r.out).toEqual(def.out);
      // The View subsystem is gone (visualisations are control nodes now),
      // but the lossless contract still holds: legacy `view:`/`viewState:`
      // are just unknown pass-through keys the serializer must preserve
      // verbatim (it deep-clones and mutates only `in:` edges + editor pos),
      // so a hand-edited boardgames.yml never churns.
      expect(r.view).toEqual(def.view);
      expect(r.viewState).toEqual(def.viewState);
      // Co-evolution edits the serializer applies on round-trip:
      //  - `editor.actions` still round-trips (no UI consumer yet, but
      //    tibi uses it).
      //  - `editor.col/row` are dropped (Dagre owns display now).
      //  - `editor.group` is lifted to a top-level `group:` key.
      expect(r.editor?.actions).toEqual(def.editor?.actions);
      expect(r.editor?.col).toBeUndefined();
      expect(r.editor?.row).toBeUndefined();
      expect(r.editor?.group).toBeUndefined();
      expect(r.group ?? null).toEqual(
        def.group ?? def.editor?.group ?? null
      );
    }
  });
});
