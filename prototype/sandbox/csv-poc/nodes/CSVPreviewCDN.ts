import type { CocoonProcessNode, ControlHook } from '../../../core/contract.ts';

/**
 * Bundling POC, case B — **each node carries its own pinned deps as CDN
 * URLs.** No `node_modules`, no project `package.json` entry; the version
 * is declared inline next to the call site.
 *
 *  - process() does `await import('https://esm.sh/papaparse@5.5.3')` —
 *    served on the Node side by `core/http-import-loader.mjs` (registered
 *    in `cli.ts`), the symmetric twin of the esbuild `httpLoader` plugin.
 *    Disk-cached, so subsequent runs are offline + instant.
 *  - hook does `await import('https://esm.sh/marked@12.0.2')` — fetched +
 *    inlined into the served bundle by the existing esbuild plugin.
 *
 * Versions are co-located with the import (literally on the same line); a
 * different node in the same flow can pin a different version of the same
 * lib without coordination. The two loaders mean both sides of the same
 * file follow the same convention.
 *
 * Trade vs case A: bundle-time/first-run network dep + a supply-chain
 * surface, mitigated by exact version pinning + disk cache. Already an
 * accepted trade for the hook side; this just extends it to the Node side.
 */

interface Row {
  [k: string]: string;
}

const STYLE = `<style>
.control .csv-preview-cdn { display:flex; flex-direction:column; gap:6px; }
.control .csv-preview-cdn .md { background:#0b0b0e; padding:8px 10px;
  border-radius:6px; overflow:auto; font-size:11px; line-height:1.45; }
.control .csv-preview-cdn .md table { border-collapse:collapse; width:100%; }
.control .csv-preview-cdn .md th,
.control .csv-preview-cdn .md td { border:1px solid #2a2a31; padding:3px 6px;
  text-align:left; }
.control .csv-preview-cdn .md th { background:#16161b; }
.control .csv-preview-cdn .md em { color:#c4b5fd; }
.control .csv-preview-cdn .md strong { color:#fbbf24; }
.control .csv-preview-cdn .md del { color:#71717a; }
.control .csv-preview-cdn .foot { font-size:9.5px; color:#71717a; }
</style>`;

const MAX_ROWS = 30;

export const CSVPreviewCDN: CocoonProcessNode = {
  category: 'POC',
  description:
    'Same as CSVPreview, but the Node-side dep is a pinned CDN URL (no node_modules).',

  async *process(ctx) {
    const { path } = ctx.ports.read() as { path: string };
    const { promises: fs } = await import('node:fs');
    const text = await fs.readFile(ctx.resolvePath(path), 'utf8');

    // Pinned CDN URL — version literally next to the call site. Served on
    // the Node side by core/http-import-loader.mjs (disk-cached).
    const Papa = (await import('https://esm.sh/papaparse@5.5.3')) as unknown as {
      default: {
        parse: (
          input: string,
          opts: { header: boolean; skipEmptyLines: boolean }
        ) => { data: Row[]; errors: unknown[] };
      };
    };
    const { data, errors } = Papa.default.parse(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (errors.length) ctx.debug('papaparse errors', errors);

    ctx.ports.write({ data });
    return `Parsed ${data.length} rows (CDN)`;
  },

  control: {
    data(ctx) {
      const rows = (ctx.output.data as Row[] | undefined) ?? [];
      if (rows.length === 0) return { ready: false, rows: [], headers: [] };
      return {
        ready: true,
        headers: Object.keys(rows[0]),
        rows: rows.slice(0, MAX_ROWS),
      };
    },

    render(ctx) {
      const d = (ctx.data as {
        ready: boolean;
        headers: string[];
        rows: Row[];
      }) ?? { ready: false, headers: [], rows: [] };
      if (!d.ready)
        return `${STYLE}<div class="csv-preview-cdn"><p>run the node to load the CSV (CDN deps)</p></div>`;
      return `${STYLE}<div class="csv-preview-cdn">
  <div class="md" data-cocoon-hook="CSVPreviewCDN"></div>
  <p class="foot">case B — both deps via pinned CDN URLs (papaparse@5.5.3 +
    marked@12.0.2). ${d.rows.length} rows shown</p>
</div>`;
    },
  },
};

export const hook: ControlHook<{
  ready?: boolean;
  headers?: string[];
  rows?: Row[];
}> = {
  mount(el, props) {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;min-height:80px;';
    el.appendChild(root);

    let data = props.data ?? { ready: false, headers: [], rows: [] };
    let marked: { parse: (md: string) => string } | undefined;

    const toMarkdown = (headers: string[], rows: Row[]): string => {
      if (!headers.length || !rows.length) return '_(empty)_';
      const head = `| ${headers.join(' | ')} |`;
      const sep = `| ${headers.map(() => '---').join(' | ')} |`;
      const body = rows
        .map(
          r =>
            `| ${headers
              .map(h => String(r[h] ?? '').replace(/\|/g, '\\|'))
              .join(' | ')} |`
        )
        .join('\n');
      return [head, sep, body].join('\n');
    };

    const draw = () => {
      const md = toMarkdown(data.headers ?? [], data.rows ?? []);
      root.innerHTML = marked ? marked.parse(md) : `<pre>${md}</pre>`;
    };

    import('https://esm.sh/marked@12.0.2')
      .then(m => {
        marked = (m as { default: { parse: (md: string) => string } }).default;
        draw();
      })
      .catch(err => {
        root.innerHTML = `<pre>${String(err)}</pre>`;
      });

    draw();

    return {
      update(next) {
        data = (next.data as typeof data) ?? data;
        draw();
      },
      destroy() {
        root.remove();
      },
    };
  },
};
