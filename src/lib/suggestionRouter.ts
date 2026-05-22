import { tick } from 'svelte';
import type { ChangeSet, SuggestionVerdict } from './protocol';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const esc = (s: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s;

interface RouterDeps {
  /** Ensures a node's window surface is open (so its form lives in the DOM). */
  openControl(id: string): void;
  isOpen(id: string): boolean;
  recordResolved(id: string, verdict: SuggestionVerdict): void;
}

/**
 * Apply a collaborator change-set by addressing each edit's form field via the
 * shim's `name` convention. Drift-validated: if any field is missing, or any
 * `context` key that exists as a named field no longer matches, the whole
 * change-set self-invalidates as `stale` — the surface has moved on since the
 * suggestion was computed.
 */
export async function applyChangeSet(
  cs: ChangeSet,
  deps: RouterDeps
): Promise<void> {
  for (const e of cs.edits) if (!deps.isOpen(e.node)) deps.openControl(e.node);
  await tick();

  const targets = await resolveTargets(cs);
  if (!targets) return deps.recordResolved(cs.id, 'stale');

  for (const { els, value } of targets)
    for (const el of els) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  deps.recordResolved(cs.id, 'applied');
}

async function resolveTargets(cs: ChangeSet) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const acc: { els: Field[]; value: string }[] = [];
    let ok = true;
    for (const e of cs.edits) {
      const surfaces = document.querySelectorAll<HTMLElement>(
        `[data-cocoon-control="${esc(e.node)}"]`
      );
      const els: Field[] = [];
      for (const s of surfaces) {
        const f = s.querySelector<Field>(`[name="${esc(e.field)}"]`);
        if (f) els.push(f);
        if (e.context)
          for (const [k, v] of Object.entries(e.context)) {
            const cf = s.querySelector<Field>(`[name="${esc(k)}"]`);
            if (cf && cf.value !== String(v)) return null;
          }
      }
      if (els.length === 0) {
        ok = false;
        break;
      }
      acc.push({ els, value: e.value });
    }
    if (ok) return acc;
    await new Promise(r => setTimeout(r, 60));
  }
  return null;
}
