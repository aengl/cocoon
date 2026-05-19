import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Image — shows a single image read from disk, the legacy
 * `@cocoon/plugin-views` Image as a visualisation node (keystone 2/5). It
 * needs no browser render hook at all: the renderer is a plain `<img>`, so
 * `control.render` returns it directly (inert HTML — like a histogram drawn
 * as inline SVG, the sharpest demonstration that a visualisation is just a
 * control with a render and no `event`, no separate View subsystem).
 *
 * The pure data half (`control.data`) runs in the core and reads the file
 * (relative paths resolve against the cocoon file's directory, via
 * `ctx.resolvePath`, like the I/O nodes), shipping only a `data:` URI — the
 * bytes never round-trip as bulk port data. Top-level `node:fs` is fine
 * here precisely because this module exports **no `hook`**, so the delivery
 * seam never esbuild-bundles it for the browser (the symmetric-import rule
 * only binds hook-exporting modules).
 *
 * The image path is plain literal `in:` config (`path`, or `src` for the
 * legacy `viewState.src` spelling); failing that, the first incoming `data`
 * value if it is a string (the old `data[0]` default-port behaviour).
 */

const MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

interface ImageData {
  ready: boolean;
  /** A ready-to-render `data:<mime>;base64,…` URI. */
  src: string;
}

export const Image: CocoonProcessNode = {
  category: 'Visualisation',
  description: 'Shows a single image from disk (render-only control).',

  async *process(ctx) {
    const { data } = ctx.ports.read() as { data?: unknown[] };
    const rows = Array.isArray(data) ? data : [];
    ctx.ports.write({ data: rows });
    return rows.length ? `${rows.length} items` : 'image';
  },

  control: {
    async data(ctx): Promise<ImageData> {
      const inputs = ctx.ports.read() as {
        path?: unknown;
        src?: unknown;
        data?: unknown[];
      };
      const first = Array.isArray(inputs.data) ? inputs.data[0] : undefined;
      const p = inputs.path ?? inputs.src ?? first;
      if (typeof p !== 'string') return { ready: false, src: '' };
      try {
        const abs = ctx.resolvePath(p);
        const base64 = (await fs.readFile(abs)).toString('base64');
        const mime = MIMES[path.extname(abs).toLowerCase()] ?? 'image/png';
        return { ready: true, src: `data:${mime};base64,${base64}` };
      } catch {
        return { ready: false, src: '' };
      }
    },

    render(ctx) {
      const d = ctx.data as ImageData | undefined;
      if (!d?.ready)
        return `<div><p>no readable image — set <code>path:</code></p></div>`;
      // Pure inert HTML — no hook needed. The node ships its own minimal
      // styling (keystone 5/6); generic defaults handle the rest.
      return `<img src="${d.src}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;display:block" />`;
    },
  },
};
