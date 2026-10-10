import { promises as fs } from 'node:fs';
import type { CocoonProcessNode } from '../../core/contract.ts';

/**
 * Reads JSON from an http(s) URL or a path relative to the cocoon file.
 * Shared by the sandbox flows via `nodeDirs: [../shared-nodes]`.
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
      data = JSON.parse(await fs.readFile(ctx.resolvePath(uri), 'utf8'));
    }

    ctx.ports.write({ data });
    return Array.isArray(data)
      ? `Imported ${data.length} items`
      : `Imported "${uri}"`;
  },
};
