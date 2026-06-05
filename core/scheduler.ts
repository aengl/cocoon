/**
 * The frontier scheduler. `runPlan(target)` walks the target's transitive
 * upstream in topological order, fires every ready node in parallel, races
 * completions, and re-evaluates. Errors fold into node state; downstream of
 * a failed node surfaces as `error: "Blocked — …"`. The target ALWAYS runs;
 * only its transitive upstream is memoise-eligible (persist's "serve cached"
 * still applies inside `runOne`).
 */
import type { CocoonEdge } from '../src/lib/cocoon-file.ts';
import type { NodeState, NodeStatus } from '../src/lib/protocol.ts';

type Readiness =
  | { kind: 'ready' }
  | { kind: 'wait' }
  // `failed` = an upstream that errored (or was itself blocked); `empty` = an
  // upstream that finished cleanly but wrote nothing on a port we read. Kept
  // apart so the painted message doesn't cry "failed" at a green producer.
  | { kind: 'blocked'; failed: string[]; empty: string[] };

export interface Blockers {
  failed: string[];
  empty: string[];
}

export interface SchedulerDeps {
  edges: CocoonEdge[];
  /** Topological order of `target`'s upstream cone (inclusive of `target`). */
  topoSort(target: string): string[];
  transitiveDownstream(id: string): string[];
  markStale(id: string): Promise<void>;
  /** Execute one node. MUST NOT reject — errors land on node state. */
  runOne(id: string): Promise<void>;
  hasOutputs(id: string): boolean;
  getStatus(id: string): NodeStatus | undefined;
  /** The last-painted error message for `id`, if any — used to compose the
   *  scheduler's terminal throw. */
  getError(id: string): string | undefined;
  setState(id: string, patch: Partial<NodeState>): void;
  /** Failure-state painters. The patch shape stays in the runtime — the
   *  scheduler only knows which sites map to "blocked" vs "deadlocked". */
  paintBlocked(id: string, blockers: Blockers): void;
  paintDeadlocked(id: string): void;
}

export async function runPlan(
  target: string,
  opts: { rerunStale?: boolean },
  deps: SchedulerDeps
): Promise<void> {
  const rerunStale = opts.rerunStale === true;
  // "Run to here" makes the target the fresh frontier: anything strictly
  // downstream was computed from its old output, so age it stale.
  for (const d of deps.transitiveDownstream(target)) await deps.markStale(d);

  // The target ALWAYS runs (a user click on a green node expects work); only
  // transitive upstream is memoise-eligible. Persist fast-path in `runOne`
  // still applies — "persist" means "serve cached" by intent.
  const order = deps.topoSort(target);
  const toRun = new Set<string>();
  for (const id of order) {
    const st = deps.getStatus(id);
    if (id !== target && st === 'done' && deps.hasOutputs(id)) continue;
    if (id !== target && !rerunStale && st === 'stale' && deps.hasOutputs(id))
      continue;
    toRun.add(id);
    // Don't clobber a node already queued/running — an overlapping plan may
    // have it in flight; downgrading `running→queued` mis-paints it.
    if (st && st !== 'queued' && st !== 'running')
      deps.setState(id, {
        status: 'queued',
        error: undefined,
        errorStack: undefined,
        inputDigest: undefined,
        errorAt: undefined,
      });
  }

  // Frontier scheduler: each iteration promotes every ready node, fires them
  // in parallel, then races their completion before re-evaluating. Diamond
  // A → {B,C} → D: B and C run in parallel after A; D fires when both have
  // produced outputs.
  const failed = new Set<string>();
  const active = new Map<string, Promise<void>>();
  const pending = new Set(toRun);

  const classify = (id: string): Readiness => {
    const failedB: string[] = [];
    const emptyB: string[] = [];
    let waiting = false;
    for (const e of deps.edges) {
      if (e.to !== id) continue;
      if (failed.has(e.from)) failedB.push(e.from);
      else if (pending.has(e.from) || active.has(e.from)) waiting = true;
      else if (!deps.hasOutputs(e.from)) emptyB.push(e.from);
    }
    if (failedB.length || emptyB.length)
      return { kind: 'blocked', failed: failedB, empty: emptyB };
    if (waiting) return { kind: 'wait' };
    return { kind: 'ready' };
  };

  while (pending.size > 0 || active.size > 0) {
    // Iterate a snapshot so `pending.delete` doesn't trip the iterator.
    for (const id of [...pending]) {
      const r = classify(id);
      if (r.kind === 'blocked') {
        failed.add(id);
        pending.delete(id);
        deps.paintBlocked(id, { failed: r.failed, empty: r.empty });
      } else if (r.kind === 'ready') {
        pending.delete(id);
        const p = deps.runOne(id).finally(() => {
          active.delete(id);
          if (deps.getStatus(id) === 'error') failed.add(id);
        });
        active.set(id, p);
      }
    }

    if (pending.size === 0 && active.size === 0) break;

    if (active.size === 0) {
      // Pending with nothing in flight and nothing classifiable as ready/
      // blocked: a dependency cycle slipped past topoSort. Surface remaining
      // nodes as errored rather than spin forever.
      for (const id of [...pending]) {
        failed.add(id);
        pending.delete(id);
        deps.paintDeadlocked(id);
      }
      break;
    }

    // `runOne` folds errors into node state — never rejects — so race is
    // safe without an extra catch.
    await Promise.race(active.values());
  }

  // `cocoon run` exits non-zero only when the requested target itself failed;
  // unrelated branches don't count.
  if (failed.has(target))
    throw new Error(
      `Cannot process "${target}": ${deps.getError(target) ?? 'upstream failure'}`
    );
}
