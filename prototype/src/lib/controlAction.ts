import type { Action } from 'svelte/action';
import type { ViewRenderer, ViewInstance } from './view-contract';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRenderer = ViewRenderer<any, any>;

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
   * late hook. Same `ViewRenderer` contract as the (retiring) view layer:
   * one render path, not a third.
   */
  hook?: AnyRenderer;
  /**
   * The core-computed `controlData` (the `control.data` payload — the
   * `serialiseViewData` twin). Fed to a hook's `mount`/`update` as
   * `props.data`; it changes data-only (no HTML churn), so a hook updates in
   * place instead of being torn down (the morphdom-lite noted below).
   */
  data?: unknown;
}

/**
 * The streamed-HTML control shim — the entire browser side of the
 * Phoenix-LiveView-style control loop, generic and node-agnostic. The twin
 * of `viewAction.ts`, and the same architectural bet: the node's *code*
 * never reaches the browser, only its rendered output, so the
 * registry-free / browser-is-a-pure-viewer keystone holds.
 *
 * Contract with the node's `control.render`: any element carrying a
 * `data-cocoon-event="<name>"` fires that event back over the WS with its
 * enclosing <form>'s fields as the payload. A `<form data-cocoon-event>`
 * fires on submit (so a plain submit <button> works); a `<button
 * type="button" data-cocoon-event>` fires on click.
 *
 * v1 swaps the whole DOM on each new `html` (the form is *uncontrolled* — we
 * never re-render per keystroke, only on explicit events — so focus loss is
 * rare). Idiomorph/morphdom is the ~2kb drop-in here if/when live partial
 * updates are wanted; deliberately not a dependency yet.
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

  // Mounted hook instances (the `phx-hook` analogue). Tracked so a data-only
  // refresh updates them in place and an unmount tears them down — never a
  // re-instantiate on every node-state tick (that would thrash a hook's
  // canvas). Reuses the view layer's `ViewInstance` verbatim: one contract.
  let currentHtml: string | undefined;
  let hookInstances: ViewInstance[] = [];
  const hookProps = () => ({
    data: p.data,
    viewState: {} as Record<string, unknown>,
    setViewState: () => {},
  });

  const destroyHooks = () => {
    for (const h of hookInstances)
      try {
        h.destroy();
      } catch {
        /* a hook's own teardown must not break the shim */
      }
    hookInstances = [];
  };

  // One hook per node (co-located module ⇒ one render hook): mount it into
  // every `[data-cocoon-hook]` element. The attribute is just a placement
  // marker now — resolution is by the node, not a name (no registry).
  const mountHooks = () => {
    if (!p.hook || hookInstances.length) return;
    for (const node of el.querySelectorAll<HTMLElement>(
      '[data-cocoon-hook]'
    ))
      hookInstances.push(p.hook.mount(node, hookProps()));
  };

  // Full DOM swap (the form is uncontrolled — only on real HTML change, see
  // `update`). innerHTML wipes any mounted hook DOM, so tear down first.
  const render = () => {
    destroyHooks();
    el.innerHTML = p.html;
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
  // `focusout`. A control event re-renders the surface (`render()` swaps
  // innerHTML); that removes the focused element and fires `focusout`
  // *synchronously inside Svelte's flush*. Capturing there writes presence
  // `$state` mid-flush → the presence effect re-enters → Svelte aborts
  // reactivity (whole UI freezes, ~0 CPU, reload-only recovery). `input`
  // never fires on programmatic innerHTML replacement, and the setTimeout
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
      // HTML changed → full swap + re-mount hooks. HTML unchanged → a
      // data-only tick: keep the DOM (and the hook's canvas), mount a
      // late-arriving hook (the async import may resolve after the HTML),
      // then update mounted hooks in place. The morphdom-lite the comment
      // above anticipated — a hooked control isn't re-instantiated on every
      // unrelated node-state push.
      if (next.html !== currentHtml) render();
      else {
        mountHooks();
        for (const h of hookInstances) h.update(hookProps());
      }
    },
    destroy() {
      clearTimeout(draftTimer);
      destroyHooks();
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
      el.removeEventListener('input', onInput);
    },
  };
};
