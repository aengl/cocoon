import type { CocoonView } from '../view-contract';

/**
 * A collapsible data tree — the legacy `Inspector` view. Zero dependencies,
 * same ethos as `sparkline.ts`: the pure `serialiseViewData` half runs in the
 * core (so only a small slice crosses the wire); the imperative `mount` half
 * draws plain DOM in the browser. No framework, no library.
 */

export interface InspectorData {
  /** The value to inspect — a single item if the port held exactly one. */
  value: unknown;
}

export interface InspectorState {
  /** How many levels are expanded initially (legacy `expandLevel`). */
  expandLevel?: number;
}

export const Inspector: CocoonView<InspectorData, InspectorState> = {
  serialiseViewData(data, _state) {
    if (!data.length) return null;
    // Keep payload tiny: most Inspector uses target a single filtered item.
    return { value: data.length === 1 ? data[0] : data };
  },

  mount(el, props) {
    const root = document.createElement('div');
    root.className = 'cocoon-inspector';
    el.appendChild(root);
    let current = props;

    const isPrimitive = (v: unknown) =>
      v === null || typeof v !== 'object';

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

      const open = depth < (current.viewState.expandLevel ?? 1);
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
      root.replaceChildren(node(null, current.data.value, 0));
    };
    render();

    return {
      update(next) {
        current = next;
        render();
      },
      destroy() {
        root.remove();
      },
    };
  },
};
