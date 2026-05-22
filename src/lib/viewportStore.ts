/**
 * Remember the camera (pan + zoom) per Cocoon file. Keyed by the core's file
 * path so each flow keeps its own last view. Only genuine user gestures are
 * saved (see App's `onmoveend`). When a saved view exists, FitOnLoad
 * restores it instead of running the framing heuristic.
 *
 * Storage failures (private mode, quota, disabled) are swallowed — the
 * heuristic is always a safe fallback.
 */

type Viewport = { x: number; y: number; zoom: number };

const key = (file: string) => `cocoon:viewport:${file}`;

export function loadViewport(file: string | undefined): Viewport | null {
  if (!file || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key(file));
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (
      v &&
      typeof (v as Viewport).x === 'number' &&
      typeof (v as Viewport).y === 'number' &&
      typeof (v as Viewport).zoom === 'number'
    )
      return v as Viewport;
  } catch {
    /* corrupt JSON or storage blocked — fall back to the heuristic */
  }
  return null;
}

export function saveViewport(
  file: string | undefined,
  v: Viewport
): void {
  if (!file || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      key(file),
      JSON.stringify({ x: v.x, y: v.y, zoom: v.zoom })
    );
  } catch {
    /* quota or storage blocked — non-fatal */
  }
}
