/**
 * Port vs config (the keystone-6 refinement): an `in:` key is a connectable
 * **port** only when its value is a `cocoon://` edge. A purely literal `in:`
 * value is **configuration** — kept verbatim by the lossless contract and
 * shown as the title-line slice, but it gets NO port handle. The grammar's
 * own edge-vs-literal split is the sole discriminator: no code-declared
 * schema, no per-node config list ("supplied via YAML ⇒ not a port; an edge
 * ⇒ a port"). Piping a config value like `path: ratings.json` from another
 * node is visual-programming theatre (a legacy artefact of having only ports
 * to supply values), not a real use-case.
 */
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadCocoonFile, serializeCocoonFile } from '../definition';

const dataOf = (yml: string, id: string) =>
  loadCocoonFile(yml).nodes.find(n => n.id === id)!.data;

describe('port vs config — only edge-valued `in:` keys are ports', () => {
  it('a literal `in:` value is config, not a port (the RateGames shape)', () => {
    const yml = `nodes:
  Games:
    type: ReadJSON
    in:
      uri: games.json
  RateGames:
    type: RateGames
    in:
      data: cocoon://Games/out/data
      key: id
      path: ratings.json
`;
    const games = dataOf(yml, 'Games');
    // `uri: games.json` is a literal → config, no port. No edges either, so
    // the node falls back to nothing here (the editor shows a default stub).
    expect(games.inPorts).toEqual([]);
    expect(Object.keys(games.params)).toEqual(['uri']);

    const rate = dataOf(yml, 'RateGames');
    // Only the edge-valued `data` is a port; `key`/`path` are config.
    expect(rate.inPorts).toEqual(['data']);
    expect(Object.keys(rate.params)).toEqual(['key', 'path']);
    expect(rate.params).toEqual({ key: 'id', path: 'ratings.json' });
  });

  it('a mixed multi-edge + literal key is BOTH a port and shown config', () => {
    const yml = `nodes:
  A:
    type: T
  B:
    type: T
    in:
      data:
        - cocoon://A/out/x
        - literalFallback
`;
    const b = dataOf(yml, 'B');
    expect(b.inPorts).toEqual(['data']); // it carries an edge
    expect(b.params).toEqual({ data: 'literalFallback' }); // and a literal
  });

  it('the lossless contract still holds — literal config round-trips verbatim', () => {
    const yml = `nodes:
  Games:
    type: ReadJSON
    in:
      uri: games.json
  RateGames:
    type: RateGames
    in:
      data: cocoon://Games/out/data
      key: id
      path: ratings.json
`;
    const g = loadCocoonFile(yml);
    const round = serializeCocoonFile(g.file, g.nodes, g.edges);
    // Semantic losslessness (the actual contract — the serializer may
    // reformat whitespace; backcompat asserts the same way): config lives
    // in versioned YAML, not a control, not lost — it stays exactly where
    // the author put it, `key`/`path` literals untouched.
    expect(parse(round)).toEqual(parse(yml));
  });
});
