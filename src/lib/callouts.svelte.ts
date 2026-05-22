/**
 * Agent-announced callouts: snapshot-on-observation, so a marker survives the
 * announcer's disconnect (presence itself evaporates with the socket).
 *
 * Re-announce of an id supersedes the snapshot AND resurrects it if dismissed.
 * Dismissals from peers (`dismissedCallouts`) are treated identically to a
 * human ✕ — once anyone clears a callout it stays cleared until a re-announce.
 *
 * The short labels (`C1`, `C2`, …) are assigned in first-seen order and never
 * recycle, so chat references stay stable through a session.
 */
import type { Callout, PresenceEntry } from './protocol';

let snap = $state(new Map<string, Callout>());
let dismissed = $state(new Set<string>());
let labels = $state(new Map<string, string>());
let seq = 0;
let cursor = $state(0);
let autoCentered = false;
let centerTarget = $state<string | undefined>();

/**
 * Stable iteration order by (ts, id) so the carousel index doesn't shuffle
 * when an agent re-announces a callout with an updated message.
 */
function orderedIds(): string[] {
  return [...snap.values()]
    .filter(c => !dismissed.has(c.id))
    .sort(
      (a, b) =>
        (a.ts ?? 0) - (b.ts ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map(c => c.id);
}

const visible = $derived(
  orderedIds()
    .map(id => snap.get(id))
    .filter((c): c is Callout => !!c)
);

const byNode = $derived(
  (() => {
    const m = new Map<string, Callout[]>();
    for (const c of visible) {
      const arr = m.get(c.node);
      if (arr) arr.push(c);
      else m.set(c.node, [c]);
    }
    return m;
  })()
);

const nodeSet = $derived(new Set(byNode.keys()));

export const callouts = {
  get snap() {
    return snap;
  },
  get dismissed() {
    return dismissed;
  },
  get labels() {
    return labels;
  },
  get visible() {
    return visible;
  },
  get byNode() {
    return byNode;
  },
  get nodeSet() {
    return nodeSet;
  },
  get cursor() {
    return cursor;
  },
  get centerTarget() {
    return centerTarget;
  },
  set centerTarget(v: string | undefined) {
    centerTarget = v;
  },

  step(delta: 1 | -1) {
    if (!visible.length) return;
    const n = visible.length;
    cursor = (((cursor + delta) % n) + n) % n;
    centerTarget = visible[cursor].node;
  },

  dismiss(id: string) {
    if (!snap.has(id) || dismissed.has(id)) return;
    dismissed = new Set([...dismissed, id]);
    const n = orderedIds().length;
    if (cursor >= n) cursor = Math.max(0, n - 1);
  },

  /**
   * Reconcile against the latest peer-presence snapshot. Returns true iff any
   * observable state changed — useful to skip downstream churn.
   */
  ingest(peers: PresenceEntry[]): boolean {
    let mutated = false;
    let firstNewId: string | undefined;
    const nextLabels = new Map(labels);
    const nextSnap = new Map(snap);
    const nextDismissed = new Set(dismissed);

    for (const p of peers) {
      const list = p.data?.callouts;
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        if (!c?.id || !c.node || typeof c.message !== 'string') continue;
        const fresh = !nextSnap.has(c.id);
        const prev = nextSnap.get(c.id);
        nextSnap.set(c.id, {
          id: c.id,
          node: c.node,
          message: c.message,
          from: c.from,
          tone: c.tone,
          ts: c.ts ?? prev?.ts ?? Date.now(),
        });
        if (!nextLabels.has(c.id)) {
          nextLabels.set(c.id, `C${++seq}`);
          mutated = true;
          firstNewId ??= c.id;
        }
        if (fresh) mutated = true;
        else if (
          prev &&
          (prev.message !== c.message ||
            prev.node !== c.node ||
            prev.tone !== c.tone)
        )
          mutated = true;
        if (nextDismissed.delete(c.id)) mutated = true;
      }
    }

    for (const p of peers) {
      const dl = p.data?.dismissedCallouts;
      if (!Array.isArray(dl)) continue;
      for (const id of dl) {
        if (typeof id !== 'string') continue;
        if (!nextSnap.has(id)) continue;
        if (!nextDismissed.has(id)) {
          nextDismissed.add(id);
          mutated = true;
        }
      }
    }

    if (mutated) {
      snap = nextSnap;
      labels = nextLabels;
      dismissed = nextDismissed;
    }

    if (firstNewId && !autoCentered) {
      autoCentered = true;
      const c = nextSnap.get(firstNewId);
      if (c) {
        centerTarget = c.node;
        const ordered = orderedIds();
        const i = ordered.indexOf(firstNewId);
        if (i >= 0) cursor = i;
      }
    }
    return mutated;
  },
};
