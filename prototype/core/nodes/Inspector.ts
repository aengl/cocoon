import type { CocoonProcessNode, ControlHook } from '../contract.ts';

/**
 * Inspector — a collapsible data tree, the legacy `Inspector` view as a
 * visualisation node (keystone 2/5). Zero dependencies; pure
 * `serialiseViewData` half is `control.data` (core, bounded — most Inspector
 * uses target a single filtered item, so the payload is tiny), imperative
 * render half is `export const hook` (plain DOM). No `event` — a
 * visualisation is a control with a render hook and nothing else.
 *
 * `process` is a pure pass-through. `expandLevel` (how many levels open
 * initially — the old `viewState.expandLevel`) is plain literal `in:`
 * config.
 */

interface InspectorData {
  ready: boolean;
  /** A single item if the port held exactly one, else the whole list. */
  value: unknown;
  expandLevel: number;
}

/**
 * The node ships its own styling (keystone 5/6 — HTML is data, the source is
 * the contract); `CocoonNode` keeps only generic defaults. Scoped under
 * `.control .cocoon-inspector` so co-resident control surfaces can't collide.
 */
const STYLE = `<style>
.control .cocoon-inspector { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 10.5px; line-height: 1.55; color: #d4d4d8; }
.control .cocoon-inspector .toggle { cursor: pointer; user-select: none; }
.control .cocoon-inspector .caret { color: #71717a; margin-right: 3px; }
.control .cocoon-inspector .key { color: #93c5fd; }
.control .cocoon-inspector .meta { color: #71717a; }
.control .cocoon-inspector .val.num { color: #f0abfc; }
.control .cocoon-inspector .val.str { color: #86efac; }
.control .cocoon-inspector .val.bool,
.control .cocoon-inspector .val.null { color: #fca5a5; }
</style>`;

export const Inspector: CocoonProcessNode = {
  category: 'Visualisation',
  description: 'Collapsible data tree rendered by a zero-dep control hook.',

  async *process(ctx) {
    const { data } = ctx.ports.read() as { data?: unknown[] };
    const rows = Array.isArray(data) ? data : [];
    ctx.ports.write({ data: rows });
    return `${rows.length} items`;
  },

  control: {
    data(ctx): InspectorData {
      const cfg = ctx.ports.read() as { expandLevel?: number };
      const out = ctx.output.data;
      const rows = Array.isArray(out) ? out : [];
      if (!rows.length)
        return { ready: false, value: null, expandLevel: 1 };
      return {
        ready: true,
        // Keep the payload tiny: a single item if the port held exactly one.
        value: rows.length === 1 ? rows[0] : rows,
        expandLevel: Number(cfg.expandLevel ?? 1),
      };
    },

    render(ctx) {
      const d = ctx.data as InspectorData | undefined;
      const compact = ctx.surface === 'node';
      if (!d?.ready) {
        const msg = 'run the node to inspect the data';
        return compact
          ? `${STYLE}<div class="inspector-compact"><strong>Inspector</strong><p>${msg}</p>
  <button data-cocoon-event="$open">Open inspector ▸</button></div>`
          : `${STYLE}<div><p>${msg}</p></div>`;
      }
      // One renderer, two surfaces: a peek inline, the full tree in the
      // window. The hook scales to its host either way.
      if (compact)
        return `${STYLE}<div class="inspector-compact">
  <div class="cocoon-inspector" data-cocoon-hook="Inspector" style="max-height:150px;overflow:auto"></div>
  <button data-cocoon-event="$open">Open inspector ▸</button>
</div>`;
      return `${STYLE}<div class="cocoon-inspector" data-cocoon-hook="Inspector"></div>`;
    },
  },
};

/**
 * The browser render hook — same source module as the node (keystone 2/5).
 * Zero-dep plain DOM; the core never evaluates it (delivery seam bundles
 * only this export). `props.data` is the streamed `controlData`.
 */
export const hook: ControlHook<InspectorData> = {
  mount(el, props) {
    const root = document.createElement('div');
    el.appendChild(root);
    let data = props.data;

    const isPrimitive = (v: unknown) => v === null || typeof v !== 'object';

    const preview = (v: unknown): string => {
      if (Array.isArray(v)) return `Array(${v.length})`;
      if (v && typeof v === 'object')
        return `{ ${Object.keys(v as object)
          .slice(0, 3)
          .join(', ')}${Object.keys(v as object).length > 3 ? ', …' : ''} }`;
      if (typeof v === 'string') return `"${v}"`;
      return String(v);
    };

    const valueClass = (v: unknown) =>
      v === null
        ? 'null'
        : typeof v === 'number'
          ? 'num'
          : typeof v === 'boolean'
            ? 'bool'
            : typeof v === 'string'
              ? 'str'
              : '';

    const node = (key: string | null, value: unknown, depth: number) => {
      const wrap = document.createElement('div');
      wrap.className = 'row';
      wrap.style.paddingLeft = `${depth * 12}px`;

      if (isPrimitive(value)) {
        wrap.innerHTML =
          (key !== null ? `<span class="key">${key}</span>: ` : '') +
          `<span class="val ${valueClass(value)}">${
            typeof value === 'string' ? `"${value}"` : String(value)
          }</span>`;
        return wrap;
      }

      const entries = Array.isArray(value)
        ? value.map((v, i) => [String(i), v] as const)
        : Object.entries(value as Record<string, unknown>);

      const open = depth < (data.expandLevel ?? 1);
      const toggle = document.createElement('div');
      toggle.className = 'row toggle';
      toggle.innerHTML =
        `<span class="caret">${open ? '▾' : '▸'}</span>` +
        (key !== null ? `<span class="key">${key}</span>: ` : '') +
        `<span class="meta">${preview(value)}</span>`;

      const children = document.createElement('div');
      children.style.display = open ? 'block' : 'none';
      for (const [k, v] of entries)
        children.appendChild(node(k, v, depth + 1));

      let shown = open;
      toggle.addEventListener('click', () => {
        shown = !shown;
        children.style.display = shown ? 'block' : 'none';
        toggle.querySelector('.caret')!.textContent = shown ? '▾' : '▸';
      });

      wrap.style.paddingLeft = '0';
      wrap.appendChild(toggle);
      const indent = document.createElement('div');
      indent.style.paddingLeft = `${depth * 12}px`;
      indent.appendChild(children);
      wrap.appendChild(indent);
      return wrap;
    };

    const render = () => {
      root.replaceChildren(node(null, data?.value ?? null, 0));
    };
    render();

    return {
      update(next) {
        data = next.data;
        render();
      },
      destroy() {
        root.remove();
      },
    };
  },
};
