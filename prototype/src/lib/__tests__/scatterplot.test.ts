/**
 * Scatterplot axis selection — the legacy `serialiseViewData` logic, now the
 * migrated `core/nodes/Scatterplot.ts` node's `control.data` half (keystone
 * 2/5: a visualisation is a control with a render hook and no `event`; there
 * is no separate View subsystem). Still the pure data half (no DOM), so it
 * runs straight in the node test env.
 *
 * Legacy-faithful auto-pick of the first/second numeric attribute when
 * `x`/`y` aren't configured (the reason the Circle example draws a circle,
 * not index-vs-index), plus the honest labelled-index fallback for a
 * configured-but-non-numeric dimension. The old `viewState` is now plain
 * literal `in:` config, read via `ctx.ports.read()`; the rows come from the
 * node's frozen pull output (`ctx.output.data`).
 */
import { describe, expect, it } from 'vitest';
import type { ControlContext } from '../../../core/contract.ts';
import { Scatterplot } from '../../../core/nodes/Scatterplot.ts';

interface ScatterPoint {
  x: number;
  y: number;
  r: number;
  c: number;
  id?: string;
  tip?: string;
}
interface ScatterData {
  ready: boolean;
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  total: number;
}

// The node's `control.data` only reads resolved inputs (literal `in:`
// config) + the node's frozen pull output (`ctx.output.data`). A minimal
// mock context exercising exactly that surface.
const ser = (data: unknown[], cfg: object): ScatterData => {
  const ctx = {
    ports: { read: () => ({ data, ...cfg }) },
    output: { data },
  } as unknown as ControlContext;
  return Scatterplot.control!.data!(ctx) as ScatterData;
};

describe('Scatterplot control.data axis selection', () => {
  // Exactly the Circle example: data is {x:sin,y:cos}, config sets only
  // color/size — legacy auto-picks x/y from the numeric attributes.
  const circle = [...Array(100)].map((_, i) => ({
    x: Math.sin(i),
    y: Math.cos(i),
  }));

  it('auto-picks first/second numeric attrs when x/y unset (Circle → circle)', () => {
    const d = ser(circle, { color: 'x', size: 'y' });
    expect(d.ready).toBe(true);
    expect(d.xLabel).toBe('x');
    expect(d.yLabel).toBe('y');
    // Real values, not the row index.
    expect(d.points[0]).toMatchObject({ x: Math.sin(0), y: Math.cos(0) });
    expect(d.points[5].x).toBeCloseTo(Math.sin(5));
    // It's a unit circle: every point ~radius 1 from the origin.
    for (const p of d.points)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 6);
  });

  it('still honours explicit x/y over the auto-pick', () => {
    const data = [
      { a: 1, b: 10, c: 100 },
      { a: 2, b: 20, c: 200 },
    ];
    const d = ser(data, { x: 'c', y: 'a' });
    expect([d.xLabel, d.yLabel]).toEqual(['c', 'a']);
    expect(d.points.map(p => p.x)).toEqual([100, 200]);
  });

  it('falls back to a labelled row index for a configured non-numeric dim', () => {
    // simple-api's `x: tz` case — USGS returns it all-null.
    const data = [
      { tz: null, mag: 1.2 },
      { tz: null, mag: 3.4 },
    ];
    const d = ser(data, { x: 'tz', y: 'mag' });
    expect(d.xLabel).toBe('tz (index)');
    expect(d.yLabel).toBe('mag');
    expect(d.points.map(p => p.x)).toEqual([0, 1]);
    expect(d.points.map(p => p.y)).toEqual([1.2, 3.4]);
  });

  it('is not ready with no rows (the pre-pull state)', () => {
    expect(ser([], {}).ready).toBe(false);
  });
});
