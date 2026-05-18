import type { Action } from 'svelte/action';

interface ControlActionParams {
  /** Inert HTML streamed from the core (the node rendered it; no node JS). */
  html: string;
  onEvent: (event: string, payload: Record<string, unknown>) => void;
  /**
   * Client-reserved `$open` (the node's compact "open form" button). Like
   * core's reserved `$mount`, `$`-prefixed events are handled here, not sent
   * to the node — opening a window is an editor concern, not a node one.
   */
  onOpen?: () => void;
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

  const render = () => {
    el.innerHTML = p.html;
  };

  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
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
      render();
    },
    destroy() {
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
    },
  };
};
