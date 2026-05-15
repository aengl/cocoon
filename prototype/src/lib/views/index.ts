/**
 * The view registry. Imported by BOTH sides:
 *  - the core calls `serialiseViewData` (the pure half) — no DOM,
 *  - the browser calls `mount` (the render half).
 * View modules therefore must not touch the DOM at module top-level (they
 * don't — DOM lives inside `mount`). Value imports use explicit `.ts` so the
 * Node-side core can load this with native type-stripping (no build step).
 */
import type { CocoonView } from '../view-contract';
import { Inspector } from './inspector.ts';
import { Scatterplot } from './scatterplot.ts';
import { Sparkline } from './sparkline.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const views: Record<string, CocoonView<any, any>> = {
  Sparkline,
  Inspector,
  Scatterplot,
};
