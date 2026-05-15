import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { CocoonFile } from '../cocoon-file';
import { extractEdges } from '../cocoon-file';
import { parseCocoonUri, parseViewString } from '../cocoon-uri';
import { loadCocoonFile, serializeCocoonFile } from '../definition';

// The canonical legacy fixtures — read straight from the repo's examples/ so
// these tests guard real backwards compatibility, not a copy that can drift.
const EXAMPLES = [
  'simple-api',
  'brushing-and-linking',
  'custom-nodes',
  'interop',
  'testing',
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

  it('parses view strings in both forms', () => {
    expect(parseViewString('Scatterplot')).toEqual({ type: 'Scatterplot' });
    expect(parseViewString('out/data/Inspector')).toEqual({
      type: 'Inspector',
      port: { incoming: false, name: 'data' },
    });
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

  it('preserves literal params and parses views', () => {
    const byId = Object.fromEntries(nodes.map(n => [n.id, n.data]));
    expect(byId.ExtractResults.params.map).toBe('x => x.features');
    expect(byId.DataFromAPI.persist).toBe(true);
    expect(byId.InspectFirstItem.view).toEqual({
      type: 'Inspector',
      port: { incoming: false, name: 'data' },
    });
    expect(byId.MapValues.view).toEqual({ type: 'Scatterplot' });
    // editor.actions must survive even though it carries no position.
    expect(byId.MapValues.actions).toEqual({
      'Open Data Documentation':
        'open https://earthquake.usgs.gov/data/comcat/data-eventterms.php',
    });
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
      expect(r.view).toEqual(def.view);
      expect(r.viewState).toEqual(def.viewState);
      expect(r.editor?.actions).toEqual(def.editor?.actions);
      // Grid position semantically equivalent (col/row default to 0).
      expect([r.editor?.col ?? 0, r.editor?.row ?? 0]).toEqual([
        def.editor?.col ?? 0,
        def.editor?.row ?? 0,
      ]);
    }
  });
});
