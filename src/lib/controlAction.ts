import type { Action } from 'svelte/action';
import { Idiomorph } from 'idiomorph';
import type { ControlHook, ControlHookInstance } from './control-render';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHook = ControlHook<any>;

interface ControlActionParams {
  /** HTML streamed from the core (the node rendered it). May carry
   *  `[data-cocoon-hook]` elements — the LiveView `phx-hook` analogue. */
  html: string;
  onEvent: (event: string, payload: Record<string, unknown>) => void;
  /**
   * Client-reserved `$open` (the node's compact "open form" button). Like
   * core's reserved `$mount`, `$`-prefixed events are handled here, not sent
   * to the node — opening a window is an editor concern, not a node one.
   */
  onOpen?: () => void;
  /**
   * The live, *unsaved* form value (every `[name]` field in this surface),
   * reported debounced on `input` (deferred via a timer — never `blur`/
   * `focusout`, which a control re-render fires synchronously and would
   * re-enter Svelte's flush). This is the editor surfacing what the human is
   * typing into the uncontrolled control as *presence* — so a peer/agent can
   * read "what's pasted in the box" without it ever being saved or touching
   * the node's control blob. Entirely optional.
   */
  onDraft?: (fields: Record<string, string>) => void;
  /**
   * The node's **one** browser render hook (keystone 2/5, the LiveView
   * `phx-hook` analogue). A node is one co-located module ⇒ one hook, so
   * this isn't a registry: every `[data-cocoon-hook]` element in the
   * streamed HTML is mounted with this single renderer. Loaded
   * asynchronously by convention from the node (the core esbuild-bundles its
   * `hook` export), so it may arrive *after* the HTML — `update` mounts a
   * late hook. One render contract (`ControlHook`); there is no separate
   * View layer — a visualisation is a hook with no `event`.
   */
  hook?: AnyHook;
  /**
   * The core-computed `controlData` (the node's `control.data` payload — the
   * pure data half). Fed to a hook's `mount`/`update` as `props.data`; it
   * changes data-only (no HTML churn), so a hook updates in place instead of
   * being torn down (the morphdom-lite noted below).
   */
  data?: unknown;
}

/**
 * The streamed-HTML control shim — the entire browser side of the
 * Phoenix-LiveView-style control loop, generic and node-agnostic, and the
 * single render path (a visualisation is just a control with a render hook
 * and no `event`). The architectural bet: the node's *code* never reaches
 * the browser, only its rendered output (HTML) + its one bundled `hook`, so
 * the registry-free / browser-is-a-pure-viewer keystone holds.
 *
 * Contract with the node's `control.render`: any element carrying a
 * `data-cocoon-event="<name>"` fires that event back over the WS with its
 * enclosing <form>'s fields as the payload. A `<form data-cocoon-event>`
 * fires on submit (so a plain submit <button> works); a `<button
 * type="button" data-cocoon-event>` fires on click.
 *
 * DOM updates go through idiomorph (the morphdom successor htmx uses) so
 * unchanged nodes — and crucially, hook subtrees with their imperative
 * state (ECharts canvases, scroll positions, focused inputs) — survive
 * across re-renders. Any element carrying `[data-cocoon-hook]` is treated
 * as opaque to morphing: idiomorph touches its position/attrs but never
 * descends into its children, so the hook owns its subtree exclusively.
 * The author writes ONE render() with all dynamic content inline; hook
 * elements don't have to be split out to survive surrounding text changes.
 */
export const control: Action<HTMLElement, ControlActionParams> = (
  el,
  params
) => {
  let p = params!;

  const formData = (
    form: HTMLFormElement | null,
    submitter?: HTMLElement | null
  ): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    // Pass the submitter so a clicked `<button name=… value=…>` (e.g. a
    // rating button) contributes its name/value, per the form spec.
    if (form)
      for (const [k, v] of new FormData(
        form,
        submitter instanceof HTMLButtonElement ? submitter : undefined
      ))
        o[k] = v;
    return o;
  };

  // `$`-prefixed events are client-reserved (never sent to the node).
  const fire = (ev: string, payload: Record<string, unknown>) => {
    if (ev === '$open') p.onOpen?.();
    else p.onEvent(ev, payload);
  };

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement)?.closest?.(
      '[data-cocoon-event]'
    ) as HTMLElement | null;
    // The form itself matches `closest` on every in-form click — it submits,
    // it doesn't "click".
    if (!t || !el.contains(t) || t.tagName === 'FORM') return;
    // A submit button *inside a form* fires `submit` (handled by onSubmit) —
    // skip it here to avoid double-firing. But a `<button>` defaults to
    // type=submit even with no form, where it does nothing natively, so we
    // must still handle that here (the `$open`/Start footgun). Keyed on the
    // associated form, not the type, so node authors needn't set type=button.
    if (t instanceof HTMLButtonElement && t.type === 'submit' && t.form) return;
    e.preventDefault();
    e.stopPropagation(); // don't bubble to Svelte Flow's node-click → process
    fire(t.dataset.cocoonEvent!, formData(t.closest('form')));
  };

  const onSubmit = (e: SubmitEvent) => {
    const form = e.target as HTMLFormElement;
    const submitter = e.submitter as HTMLElement | null;
    const ev = form.dataset.cocoonEvent ?? submitter?.dataset.cocoonEvent;
    if (!ev) return;
    e.preventDefault();
    e.stopPropagation();
    fire(ev, formData(form, submitter));
  };

  // Mounted hook instances, keyed by their host element so morphing can
  // preserve the same `(element, instance)` pair across re-renders. The
  // shim never tears a hook down to swap unrelated text around it; only
  // genuine removal of its host element from the DOM (or surface destroy)
  // unmounts it.
  let currentHtml: string | undefined;
  const hookInstances = new Map<HTMLElement, ControlHookInstance>();
  const hookProps = () => ({ data: p.data });

  const destroyAllHooks = () => {
    for (const [, h] of hookInstances)
      try {
        h.destroy();
      } catch {
        /* a hook's own teardown must not break the shim */
      }
    hookInstances.clear();
  };

  const destroyHookAt = (node: HTMLElement) => {
    const h = hookInstances.get(node);
    if (!h) return;
    try {
      h.destroy();
    } catch {
      /* see destroyAllHooks */
    }
    hookInstances.delete(node);
  };

  // Mount any `[data-cocoon-hook]` element that doesn't already have an
  // instance. Idempotent — called after every morph + after a late-arriving
  // `hook` import resolves. Not a registry: the same hook mounts into every
  // marker element; node code dispatches on `el.dataset.cocoonHook` if it
  // hosts multiple placements.
  const mountHooks = () => {
    if (!p.hook) return;
    for (const node of el.querySelectorAll<HTMLElement>(
      '[data-cocoon-hook]'
    )) {
      if (hookInstances.has(node)) continue;
      hookInstances.set(node, p.hook.mount(node, hookProps()));
    }
  };

  // Morph the DOM in place. Hook subtrees are opaque: idiomorph won't
  // descend into a `[data-cocoon-hook]` element, so the hook's imperative
  // children (canvas, chart, etc.) survive. A hook host that's been
  // *removed* in the new HTML still gets its instance destroyed via
  // `beforeNodeRemoved`. First render bootstraps with innerHTML — morphing
  // an empty root would no-op for content-only swaps but `Idiomorph.morph`
  // accepts an empty oldNode just fine; the explicit branch is a perf nit.
  const render = () => {
    if (currentHtml == null) {
      el.innerHTML = p.html;
    } else {
      Idiomorph.morph(el, p.html, {
        morphStyle: 'innerHTML',
        callbacks: {
          beforeNodeMorphed: (oldNode: Node) => {
            // Hook hosts are opaque to morphing — their children belong to
            // the hook. (`oldNode === el` is the root itself, which we DO
            // morph into.)
            if (
              oldNode instanceof HTMLElement &&
              oldNode !== el &&
              oldNode.hasAttribute('data-cocoon-hook')
            ) {
              return false;
            }
            return true;
          },
          beforeNodeRemoved: (node: Node) => {
            // Hook host disappeared from the new HTML — tear it down.
            if (node instanceof HTMLElement) {
              if (hookInstances.has(node)) destroyHookAt(node);
              // Also any nested hook hosts inside a removed subtree.
              for (const inner of node.querySelectorAll<HTMLElement>(
                '[data-cocoon-hook]'
              ))
                if (hookInstances.has(inner)) destroyHookAt(inner);
            }
            return true;
          },
        },
      });
    }
    currentHtml = p.html;
    mountHooks();
  };

  // --- live draft capture (presence, optional) -------------------------
  // Serialise every named field in the surface. Form-agnostic on purpose:
  // it mirrors the same `name` convention the shim already submits by, so a
  // suggestion can address `{node, field}` generically (no node code, no
  // schema).
  //
  // ONLY `input`, and only via a deferred timer — deliberately NOT `blur`/
  // `focusout`. A control event re-renders the surface (`render()` morphs
  // the DOM); when a focused element gets removed by the morph it fires
  // `focusout` *synchronously inside Svelte's flush*. Capturing there writes
  // presence `$state` mid-flush → the presence effect re-enters → Svelte
  // aborts reactivity (whole UI freezes, ~0 CPU, reload-only recovery).
  // Programmatic DOM mutations don't synthesise `input`, and the setTimeout
  // guarantees the (possible) `$state` write lands in a later macrotask,
  // never during a flush. This is the load-bearing reason, not a nicety.
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const collectDraft = () => {
    draftTimer = undefined;
    if (!p.onDraft) return;
    const fields: Record<string, string> = {};
    for (const f of el.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('input[name],textarea[name],select[name]')) {
      if (f.type === 'hidden') continue; // wiring (e.g. row id), not a draft
      fields[f.name] = f.value;
    }
    p.onDraft(fields);
  };
  const onInput = () => {
    if (!p.onDraft) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(collectDraft, 400);
  };

  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('input', onInput);
  render();

  // Phoenix-LiveView `mount`: tell the node its surface just appeared so it
  // can prime initial state (the node decides if it cares — for most
  // controls this is a harmless extra render). Fires once per surface mount,
  // never on `update()`; the node's handler must be idempotent (a window can
  // be reopened). Core-bound (not client-reserved like `$open`).
  p.onEvent('$mount', {});

  return {
    update(next: ControlActionParams) {
      p = next;
      // HTML changed → morph in place (idiomorph patches only what differs;
      // hook subtrees stay intact). HTML unchanged → data-only tick. Either
      // way, mount any late-arriving hook hosts and push the new data into
      // every mounted instance — the chart/canvas instance never restarts
      // on an unrelated text update.
      if (next.html !== currentHtml) render();
      else mountHooks();
      for (const [, h] of hookInstances) h.update(hookProps());
    },
    destroy() {
      clearTimeout(draftTimer);
      destroyAllHooks();
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
      el.removeEventListener('input', onInput);
    },
  };
};
