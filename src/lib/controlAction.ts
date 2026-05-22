import type { Action } from 'svelte/action';
import { Idiomorph } from 'idiomorph';
import type { ControlHook, ControlHookInstance } from './protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHook = ControlHook<any>;

interface ControlActionParams {
  /** HTML streamed from the core. May carry `[data-cocoon-hook]` elements
   *  (the LiveView `phx-hook` analogue). */
  html: string;
  onEvent: (event: string, payload: Record<string, unknown>) => void;
  /** `$open` is client-reserved (opening a window is an editor concern,
   *  not a node one); the shim handles it without dispatching to the node. */
  onOpen?: () => void;
  /**
   * Live, unsaved form value — reported debounced on `input` so a peer/agent
   * can read "what's pasted in the box" via presence. Optional.
   */
  onDraft?: (fields: Record<string, string>) => void;
  /** The node's one render hook. Loaded asynchronously; may arrive after the
   *  HTML, so `update` mounts late hooks too. */
  hook?: AnyHook;
  /** `controlData` — fed to the hook as `props.data`. Changes data-only (no
   *  HTML churn), so a hook updates in place instead of being torn down. */
  data?: unknown;
}

/**
 * The streamed-HTML control shim — the whole browser side of the
 * Phoenix-LiveView-style loop, generic and node-agnostic. A visualisation is
 * just a control with a render hook and no `event`.
 *
 * Contract with the node's `control.render`: any element carrying a
 * `data-cocoon-event="<name>"` fires that event back over the WS with its
 * enclosing `<form>`'s fields as the payload. A `<form data-cocoon-event>`
 * fires on submit (so a plain submit button works); a `<button type="button"
 * data-cocoon-event>` fires on click.
 *
 * DOM updates go through idiomorph (the morphdom successor htmx uses) so
 * unchanged nodes — and crucially, hook subtrees with imperative state
 * (charts, scroll positions, focused inputs) — survive across re-renders.
 * Any `[data-cocoon-hook]` element is opaque to morphing: idiomorph touches
 * its position/attrs but never descends into its children. The author writes
 * one `render()` with all dynamic content inline; hook elements don't have
 * to be split out to survive surrounding text changes.
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
    // Pass the submitter so a clicked `<button name=… value=…>` contributes
    // its name/value, per the form spec.
    if (form)
      for (const [k, v] of new FormData(
        form,
        submitter instanceof HTMLButtonElement ? submitter : undefined
      ))
        o[k] = v;
    return o;
  };

  const fire = (ev: string, payload: Record<string, unknown>) => {
    if (ev === '$open') p.onOpen?.();
    else p.onEvent(ev, payload);
  };

  const onClick = (e: Event) => {
    const t = (e.target as HTMLElement)?.closest?.(
      '[data-cocoon-event]'
    ) as HTMLElement | null;
    // The form itself matches `closest` on every in-form click — it submits,
    // not "clicks".
    if (!t || !el.contains(t) || t.tagName === 'FORM') return;
    // A submit button inside a form fires `submit` — skip here to avoid
    // double-firing. But `<button>` defaults to type=submit even with no
    // form, where it does nothing natively, so we still handle that here.
    // Keyed on the associated form, not the type, so node authors needn't
    // set `type=button`.
    if (t instanceof HTMLButtonElement && t.type === 'submit' && t.form) return;
    e.preventDefault();
    e.stopPropagation(); // don't bubble to the canvas-level node-click
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

  // Idempotent — called after every morph + after a late-arriving `hook`
  // import resolves. The same hook mounts into every marker; node code
  // dispatches on `el.dataset.cocoonHook` if it hosts multiple placements.
  const mountHooks = () => {
    if (!p.hook) return;
    for (const node of el.querySelectorAll<HTMLElement>(
      '[data-cocoon-hook]'
    )) {
      if (hookInstances.has(node)) continue;
      hookInstances.set(node, p.hook.mount(node, hookProps()));
    }
  };

  const render = () => {
    if (currentHtml == null) {
      el.innerHTML = p.html;
    } else {
      Idiomorph.morph(el, p.html, {
        morphStyle: 'innerHTML',
        callbacks: {
          beforeNodeMorphed: (oldNode: Node) => {
            // Hook hosts are opaque — their children belong to the hook.
            // (`oldNode === el` is the root, which we DO morph into.)
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
            if (node instanceof HTMLElement) {
              if (hookInstances.has(node)) destroyHookAt(node);
              // Any nested hook hosts inside a removed subtree.
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
  //
  // Load-bearing: ONLY `input`, and only via a deferred timer. NOT `blur`/
  // `focusout`. A control event re-renders the surface; when a focused
  // element gets removed by the morph it fires `focusout` SYNCHRONOUSLY
  // INSIDE Svelte's flush. Capturing there writes presence `$state` mid-
  // flush → the presence effect re-enters → Svelte aborts reactivity (whole
  // UI freezes, ~0 CPU, reload-only recovery). Programmatic DOM mutations
  // don't synthesise `input`, and the setTimeout guarantees the (possible)
  // `$state` write lands in a later macrotask, never during a flush.
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const collectDraft = () => {
    draftTimer = undefined;
    if (!p.onDraft) return;
    const fields: Record<string, string> = {};
    for (const f of el.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('input[name],textarea[name],select[name]')) {
      if (f.type === 'hidden') continue;
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
  // can prime initial state. Fires once per surface mount, never on
  // `update()`; the node's handler must be idempotent (a window can be
  // reopened). Core-bound, not client-reserved.
  p.onEvent('$mount', {});

  return {
    update(next: ControlActionParams) {
      p = next;
      // HTML changed → morph (idiomorph patches only what differs; hook
      // subtrees stay intact). HTML unchanged → push new data to mounted
      // hooks. Either way, mount any late-arriving hook hosts.
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
