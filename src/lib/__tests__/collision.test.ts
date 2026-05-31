import { describe, expect, it } from 'vitest';
import { pushDownCollisions } from '../collision';
import type { CocoonFlowNode } from '../definition';

/**
 * Y-only push-down overlap relief (see `collision.ts`). The mid-session pain:
 * a node grows (run reveals steering knobs + a status footer) and crashes into
 * the node below it in the same column. We push the lower node down by the
 * overlap and freeze X, so Dagre's LR columns survive.
 */

// Minimal node — the resolver only reads id/position/width/height/parentId.
const node = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string
): CocoonFlowNode =>
  ({
    id,
    position: { x, y },
    width,
    height,
    parentId,
    data: {},
  }) as unknown as CocoonFlowNode;

const M = 24; // default margin

describe('pushDownCollisions', () => {
  it('returns the same reference when nothing overlaps', () => {
    const ns = [node('a', 0, 0, 200, 100), node('b', 0, 400, 200, 100)];
    expect(pushDownCollisions(ns)).toBe(ns);
  });

  it('pushes the lower node down and keeps the upper node put', () => {
    // a grew tall (height 300) and now overlaps b (top at y=120).
    const a = node('a', 0, 0, 200, 300);
    const b = node('b', 0, 120, 200, 100);
    const out = pushDownCollisions([a, b]);
    expect(out).not.toBe([a, b]);
    const [oa, ob] = out;
    // Upper node is untouched (same object, same position).
    expect(oa).toBe(a);
    // Lower node clears a's bottom plus the 2*margin gap, X frozen.
    expect(ob.position.x).toBe(0);
    expect(ob.position.y).toBe(300 + 2 * M);
  });

  it('never moves along X even when the X overlap is smaller', () => {
    // Heavy vertical overlap, slight horizontal overlap — the naive
    // smallest-axis resolver would slide along X; we must not.
    const a = node('a', 0, 0, 200, 300);
    const b = node('b', 190, 50, 200, 300);
    const [, ob] = pushDownCollisions([a, b]);
    expect(ob.position.x).toBe(190); // X untouched
    expect(ob.position.y).toBeGreaterThan(50); // pushed down
  });

  it('leaves nodes in different columns alone (no X overlap)', () => {
    const ns = [node('a', 0, 0, 200, 300), node('b', 400, 50, 200, 300)];
    expect(pushDownCollisions(ns)).toBe(ns);
  });

  it('cascades a push through a stacked column', () => {
    // a is tall enough to overlap b; once b moves it overlaps c.
    const a = node('a', 0, 0, 200, 400);
    const b = node('b', 0, 150, 200, 100);
    const c = node('c', 0, 320, 200, 100);
    const [, ob, oc] = pushDownCollisions([a, b, c]);
    expect(ob.position.y).toBe(400 + 2 * M); // below a
    // c sits below the relocated b, fully separated.
    expect(oc.position.y).toBeGreaterThanOrEqual(ob.position.y + 100 + 2 * M);
  });

  it('resolves siblings in parent-relative space, not across parents', () => {
    // Two children of the same group overlap → resolved among themselves.
    // A child of a *different* parent at the same relative coords must not
    // interfere (separate coordinate space / bucket).
    const c1 = node('c1', 0, 0, 200, 300, 'g1');
    const c2 = node('c2', 0, 120, 200, 100, 'g1');
    const other = node('o', 0, 120, 200, 100, 'g2');
    const out = pushDownCollisions([c1, c2, other]);
    const oc2 = out.find(n => n.id === 'c2')!;
    const oo = out.find(n => n.id === 'o')!;
    expect(oc2.position.y).toBe(300 + 2 * M); // pushed within g1
    expect(oo).toBe(other); // untouched — different bucket
  });
});
