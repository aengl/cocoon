import type { CocoonFlowNode } from './definition';

/**
 * Y-only, push-down overlap resolver.
 *
 * Dagre owns the horizontal ranks (LR), so columns are sacred — when a node
 * grows (steering controls + a status footer appear on run) it only ever
 * collides with the node *below* it in the same column. The general
 * smallest-axis resolver from the Svelte Flow example would also nudge X and
 * split the push between both boxes, shoving the just-grown node sideways and
 * up into its own upstream neighbour. We want the opposite: keep X frozen, and
 * push the *lower* box straight down by the full overlap so the grown node
 * stays put and its neighbour yields. Cascades (B pushed into C) settle over
 * the iteration loop, exactly like the reference algorithm.
 *
 * Coordinates: xyflow node positions are relative to their parent, so we bucket
 * by `parentId` and resolve each sibling set in its own space — no absolute
 * conversion, and a group container never collides with its own children
 * (which would otherwise read as a false overlap and eject them). Group
 * containers themselves participate in the root bucket, so a node growing above
 * a group pushes the whole group (and its children, via relative positioning)
 * down together.
 *
 * Push-only: shrinking a node back leaves the gap it opened (we never pull
 * neighbours up — that would need the original layout). A full re-tidy is F5.
 *
 * Returns a new array when anything moved, else the same reference (so callers
 * can cheaply skip a no-op assignment and avoid a reactive churn).
 */
export type CollideOptions = {
  /** Gap to preserve around each box, px. ~half Dagre's nodesep so a resolved
   *  stack matches the auto-layout's vertical rhythm. */
  margin?: number;
  maxIterations?: number;
  /** Ignore sub-pixel overlaps (anti-jitter). */
  overlapThreshold?: number;
};

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  idx: number;
  moved: boolean;
};

const boxSize = (n: CocoonFlowNode, axis: 'width' | 'height') =>
  n[axis] ?? n.measured?.[axis] ?? 0;

export function pushDownCollisions(
  nodes: CocoonFlowNode[],
  {
    margin = 24,
    maxIterations = 50,
    overlapThreshold = 0.5,
  }: CollideOptions = {}
): CocoonFlowNode[] {
  // Bucket node indices by parent — siblings share one coordinate space.
  const buckets = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    const key = n.parentId ?? '';
    const arr = buckets.get(key);
    if (arr) arr.push(i);
    else buckets.set(key, [i]);
  });

  // idx -> resolved absolute y (in its parent's space). Only moved nodes.
  const newY = new Map<number, number>();

  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;

    const boxes: Box[] = idxs.map(idx => {
      const n = nodes[idx];
      return {
        x: n.position.x - margin,
        y: n.position.y - margin,
        width: boxSize(n, 'width') + margin * 2,
        height: boxSize(n, 'height') + margin * 2,
        idx,
        moved: false,
      };
    });

    for (let iter = 0; iter <= maxIterations; iter++) {
      let moved = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const A = boxes[i];
          const B = boxes[j];
          const dx = A.x + A.width / 2 - (B.x + B.width / 2);
          const dy = A.y + A.height / 2 - (B.y + B.height / 2);
          const px = (A.width + B.width) / 2 - Math.abs(dx);
          const py = (A.height + B.height) / 2 - Math.abs(dy);
          if (px > overlapThreshold && py > overlapThreshold) {
            // Push the lower box down by the full Y overlap; the upper one
            // (usually the just-grown node) holds. Deterministic tie-break by
            // index so equal-y nodes don't oscillate.
            const lower =
              A.y < B.y || (A.y === B.y && A.idx < B.idx) ? B : A;
            lower.y += py;
            lower.moved = moved = true;
          }
        }
      }
      if (!moved) break;
    }

    for (const b of boxes) if (b.moved) newY.set(b.idx, b.y + margin);
  }

  if (newY.size === 0) return nodes;
  return nodes.map((n, i) => {
    const y = newY.get(i);
    return y === undefined ? n : { ...n, position: { x: n.position.x, y } };
  });
}
