<script lang="ts">
  /**
   * The generic collaborator-suggestion surface — a top-left stack of
   * toasts, ONE per peer-announced change-set (keystone 5, the suggestion
   * model). Deliberately node-agnostic: it never knows a control's shape,
   * only `{node, field, value}` addressed by the existing form-`name`
   * convention. It does not steal focus or re-render anything — it just
   * shows the proposal; the human clicks Apply/Discard and the editor
   * routes it. A bubble is a *projection of the peer's current presence*
   * (re-announcing the same id supersedes; nothing is an event log).
   */
  import type { ChangeSet, PresenceEntry } from './protocol';

  let {
    peers,
    onApply,
    onDiscard,
  }: {
    peers: PresenceEntry[];
    onApply: (cs: ChangeSet) => void;
    onDiscard: (cs: ChangeSet) => void;
  } = $props();

  // One bubble per peer that currently announces a change-set. Keyed by
  // changeSet.id so a re-announce replaces (supersede), never stacks.
  const bubbles = $derived(
    (() => {
      const seen = new Map<string, { from: string; cs: ChangeSet }>();
      for (const p of peers) {
        const cs = p.data?.changeSet;
        if (cs?.id && Array.isArray(cs.edits) && cs.edits.length)
          seen.set(cs.id, { from: cs.from ?? p.data?.label ?? p.client, cs });
      }
      return [...seen.values()];
    })()
  );
</script>

{#if bubbles.length}
  <div class="toast-stack">
    {#each bubbles as b (b.cs.id)}
      <div class="toast" role="status">
        <div class="head">
          <span class="who">{b.from}</span> suggested
          {b.cs.edits.length} edit{b.cs.edits.length === 1 ? '' : 's'}
        </div>
        {#if b.cs.note}<p class="note">{b.cs.note}</p>{/if}
        <ul class="edits">
          {#each b.cs.edits.slice(0, 6) as e (e.node + '/' + e.field)}
            <li>
              <code>{e.node}.{e.field}</code>
              <span class="val">{e.value}</span>
            </li>
          {/each}
          {#if b.cs.edits.length > 6}
            <li class="more">+{b.cs.edits.length - 6} more…</li>
          {/if}
        </ul>
        <div class="row">
          <button class="apply" onclick={() => onApply(b.cs)}>Apply</button>
          <button class="discard" onclick={() => onDiscard(b.cs)}>
            Discard
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 60; /* above every ControlWindow (40+) */
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 340px;
  }
  .toast {
    background: #0b0b0fee;
    border: 1px solid #3f3f46;
    border-left: 3px solid #8b5cf6;
    border-radius: 8px;
    padding: 9px 11px;
    color: #e4e4e7;
    font-size: 12px;
    box-shadow: 0 8px 30px #000a;
  }
  .head {
    font-size: 11px;
    color: #a1a1aa;
  }
  .head .who {
    color: #c4b5fd;
    font-weight: 600;
  }
  .note {
    margin: 5px 0 4px;
    color: #d4d4d8;
  }
  .edits {
    list-style: none;
    margin: 6px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .edits li {
    display: flex;
    gap: 6px;
    align-items: baseline;
    min-width: 0;
  }
  .edits code {
    flex: none;
    color: #93c5fd;
    font-size: 10px;
  }
  .edits .val {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #a1a1aa;
  }
  .edits .more {
    color: #71717a;
    font-style: italic;
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }
  .row button {
    flex: 1;
    border-radius: 5px;
    padding: 4px 10px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid #3f3f46;
  }
  .row .apply {
    background: #6d28d9;
    color: #fff;
    border-color: #7c3aed;
  }
  .row .apply:hover {
    background: #7c3aed;
  }
  .row .discard {
    background: #27272a;
    color: #e4e4e7;
  }
  .row .discard:hover {
    background: #3f3f46;
  }
</style>
