/**
 * Scatterplot axis selection — legacy-faithful auto-pick of the first/second
 * numeric attribute when `viewState` doesn't set x/y (the reason the Circle
 * example draws a circle, not index-vs-index), plus the honest labelled-index
 * fallback for a configured-but-non-numeric dimension. `serialiseViewData` is
 * the pure half (no DOM), so it runs straight in the node test env.
 */
import { describe, expect, it } from 'vitest';
import { Scatterplot, type ScatterData } from '../views/scatterplot';

const ser = (data: unknown[], state: object) =>
  Scatterplot.serialiseViewData(data, state as never) as ScatterData;

describe('Scatterplot serialiseViewData axis selection', () => {
  // Exactly the Circle example: data is {x:sin,y:cos}, viewState sets only
  // color/size — legacy auto-picks x/y from the numeric attributes.
  const circle = [...Array(100)].map((_, i) => ({
    x: Math.sin(i),
    y: Math.cos(i),
  }));

  it('auto-picks first/second numeric attrs when x/y unset (Circle → circle)', () => {
    const d = ser(circle, { color: 'x', size: 'y' });
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
});
