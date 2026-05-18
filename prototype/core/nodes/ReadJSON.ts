import { promises as fs } from 'node:fs';
import type { CocoonProcessNode } from '../contract.ts';

/**
 * Port of legacy `@cocoon/cocoon` ReadJSON. Reads JSON from an http(s) URL or
 * a (relative-to-the-cocoon-file) local path. Node 25's global `fetch`
 * replaces legacy `got`; the disk-persist cache is handled engine-side
 * (runtime.ts), exactly as legacy kept it out of the node.
 */
export const ReadJSON: CocoonProcessNode = {
  category: 'I/O',
  description: 'Reads JSON data from a URL or a local file.',

  async *process(ctx) {
    const { uri } = ctx.ports.read() as { uri: string };
    let data: unknown;

    if (/^https?:\/\//.test(uri)) {
      yield `Requesting ${uri}`;
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      data = await res.json();
    } else {
      const p = uri.startsWith('file://') ? new URL(uri).pathname : uri;
      const abs = ctx.resolvePath(p);
      data = JSON.parse(await fs.readFile(abs, 'utf8'));
    }

    ctx.ports.write({ data });
    return Array.isArray(data)
      ? `Imported ${data.length} items`
      : `Imported "${uri}"`;
  },
};
