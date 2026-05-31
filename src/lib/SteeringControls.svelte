<script lang="ts">
  import type { ControlSchema } from './protocol';

  /**
   * Steering tier of node controls: typed, kind-driven inputs (toggle, select,
   * text, number) rendered inline. Setting a value is a session override that
   * ages the node (`stale` → re-pull); the caller wires `setControl`.
   */
  let {
    entries,
    state,
    setControl,
  }: {
    entries: [string, ControlSchema][];
    state: Record<string, unknown>;
    setControl: (key: string, value: unknown) => void;
  } = $props();
</script>

{#if entries.length}
  <section class="controls nodrag nopan nowheel">
    {#each entries as [key, c] (key)}
      <label class="ctrl ctrl-{c.kind}">
        <span class="cl">{c.label ?? key}</span>
        {#if c.kind === 'toggle'}
          <input
            type="checkbox"
            checked={!!state[key]}
            onchange={e => setControl(key, e.currentTarget.checked)}
          />
        {:else if c.kind === 'select'}
          <select
            value={String(state[key] ?? '')}
            onchange={e => setControl(key, e.currentTarget.value)}
          >
            {#each c.options as opt (opt)}
              <option value={opt}>{opt}</option>
            {/each}
          </select>
        {:else if c.kind === 'number'}
          <input
            type="number"
            value={Number(state[key] ?? 0)}
            min={c.min ?? undefined}
            max={c.max ?? undefined}
            step={c.step ?? undefined}
            onchange={e => setControl(key, e.currentTarget.valueAsNumber)}
          />
        {:else if c.multiline}
          <textarea
            rows="2"
            placeholder={c.placeholder ?? ''}
            value={String(state[key] ?? '')}
            onchange={e => setControl(key, e.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            type="text"
            placeholder={c.placeholder ?? ''}
            value={String(state[key] ?? '')}
            onchange={e => setControl(key, e.currentTarget.value)}
          />
        {/if}
      </label>
    {/each}
  </section>
{/if}

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid #27272a;
    background: #1c1c20;
  }
  .ctrl {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
  }
  .ctrl .cl {
    flex: none;
    color: #c4b5fd;
    font-size: 10.5px;
    min-width: 56px;
  }
  /* Toggles and numbers stay inline: small control on the right,
     label fills the row and may wrap. */
  .ctrl.ctrl-toggle,
  .ctrl.ctrl-number {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  .ctrl.ctrl-toggle .cl,
  .ctrl.ctrl-number .cl {
    flex: 1;
  }
  .ctrl.ctrl-number input[type='number'] {
    flex: none;
    width: 52px;
  }
  .ctrl input[type='text'],
  .ctrl input[type='number'],
  .ctrl select,
  .ctrl textarea {
    flex: 1;
    min-width: 0;
    background: #0d0d0f;
    color: #e4e4e7;
    border: 1px solid #3f3f46;
    border-radius: 4px;
    padding: 3px 5px;
    font-size: 10.5px;
    font-family: inherit;
  }
  .ctrl textarea {
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
  .ctrl input[type='checkbox'] {
    flex: none;
    appearance: none;
    -webkit-appearance: none;
    position: relative;
    width: 30px;
    height: 17px;
    border-radius: 999px;
    background: #3f3f46;
    border: 1px solid #52525b;
    cursor: pointer;
    transition: background 0.18s ease, border-color 0.18s ease;
  }
  .ctrl input[type='checkbox']::after {
    content: '';
    position: absolute;
    top: 1px;
    left: 1px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #e4e4e7;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    transition: transform 0.18s ease, background 0.18s ease;
  }
  .ctrl input[type='checkbox']:checked {
    background: #8b5cf6;
    border-color: #8b5cf6;
  }
  .ctrl input[type='checkbox']:checked::after {
    transform: translateX(13px);
    background: #fff;
  }
  .ctrl input[type='checkbox']:focus-visible {
    outline: none;
    border-color: #a78bfa;
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35);
  }
  .ctrl input:focus,
  .ctrl select:focus,
  .ctrl textarea:focus {
    outline: none;
    border-color: #8b5cf6;
  }
</style>
