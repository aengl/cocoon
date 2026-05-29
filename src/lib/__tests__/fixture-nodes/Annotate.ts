import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isObject, merge } from './lodash-lite.ts';
import type { CocoonProcessNode } from '../../../../core/contract.ts';

interface AnnotationData {
  [key: string]: Record<string, unknown>;
}

/**
 * Port of legacy `@cocoon/cocoon` io/Annotate (the boardgames flow's
 * `bgg_annotations.json` merge). lodash shed to `../lodash-lite.ts`
 * (`merge`/`isObject`); legacy `resolveFilePath` → cocoon-dir-relative
 * resolution like the other I/O nodes.
 *
 * The legacy `receive` write-back (the annotation editor persisting edits
 * back into the JSON) is now a **free-form control** (keystone 5 action
 * tier, the Phoenix-LiveView model): `control.render` streams the editor
 * HTML, `control.event` handles load/save. The legacy `context.invalidate()`
 * + auto-rerun (the deleted "Annotate trick") is replaced by `ctx.markStale()`
 * — a pull graph: the user/agent re-pulls and `process()` (unchanged — it
 * already re-reads the file and merges by `key`) folds the edit back in.
 * The annotation file is the node's own durable I/O; the control is only the
 * trigger. Node and control are one module by design.
 */
export const Annotate: CocoonProcessNode = {
  category: 'I/O',
  description: `Merges annotations stored in a JSON file into the data.`,

  async *process(context) {
    const { debug } = context;
    const { data, key } = context.ports.read() as {
      data: Record<string, string>[];
      key: string;
      path: string;
    };
    const annotations = await readAnnotationData(context);

    // Faithful legacy port: a bare map. Multi-edge concatenation is the
    // port-read layer's job (resolveInputs ⇄ legacy graph.ts#getPortData),
    // never the node's.
    let numAnnotated = 0;
    const annotatedData = data.map(item => {
      if (!(key in item)) {
        debug(`error: no key in item`, item);
        throw new Error(`one ore more items are lacking a key attribute`);
      }
      const annotation = annotations[item[key]];
      if (annotation) {
        numAnnotated += 1;
        return merge(item, annotation);
      }
      return item;
    });

    context.ports.write({
      annotations,
      data: annotatedData,
    });
    return `Annotated ${numAnnotated} items`;
  },

  control: {
    // Inert HTML. Cocoon's global `.control` rules supply only skin
    // (colour/border/type/focus); layout is the node's own — here a tiny
    // streamed <style> stacks each label's caption above its field.
    // `key`/`annotation` round-trip through the opaque control blob
    // (ctx.control.read/set).
    render(ctx) {
      const s = ctx.control.read() as { key?: string; annotation?: string };
      return `
<style>.control form { display:flex; flex-direction:column; gap:6px; }
.control label { display:flex; flex-direction:column; gap:3px; }</style>
<form data-cocoon-event="save">
  <label>key
    <input name="key" value="${esc(s.key ?? '')}" placeholder="row key value" />
  </label>
  <label>annotation (JSON)
    <textarea name="annotation" rows="7" placeholder="{ }">${esc(
      s.annotation ?? ''
    )}</textarea>
  </label>
  <div style="display:flex;gap:6px">
    <button type="button" data-cocoon-event="load">Load</button>
    <button type="submit">Save</button>
  </div>
</form>`;
    },

    async event(ctx, ev) {
      const p = (ev.payload ?? {}) as { key?: string; annotation?: string };
      const key = String(p.key ?? '').trim();

      if (ev.event === 'load') {
        // Prefill the editor with the current annotation for `key`.
        const annotations = await readAnnotationData(ctx);
        ctx.control.set({
          key,
          annotation: JSON.stringify(annotations[key] ?? {}, null, 2),
        });
        return; // load changes nothing in the pipe — no markStale
      }

      if (ev.event === 'save') {
        if (!key) return void ctx.debug('save ignored: empty key');
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(String(p.annotation || '{}'));
        } catch (err) {
          return void ctx.debug('save ignored: invalid JSON', err);
        }
        const annotations = await readAnnotationData(ctx);
        // Legacy `receive` parity: the whole edited object + the timestamp.
        annotations[key] = {
          ...parsed,
          $last_annotated: new Date().toISOString(),
        };
        await writeAnnotationData(ctx, annotations);
        ctx.control.set({ key: '', annotation: '' });
        // Pull graph: age the node so the next pull re-reads the file and
        // re-merges. NOT legacy's invalidate()+auto-rerun (the deleted trick).
        ctx.markStale();
      }
    },
  },
};

/** Minimal HTML-attribute/-text escape (trusted author, but correctness). */
const esc = (v: unknown): string =>
  String(v).replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!
  );

async function writeAnnotationData(
  context: {
    ports: { read(): Record<string, unknown> };
    resolvePath(...segments: string[]): string;
  },
  data: AnnotationData
): Promise<void> {
  const { path: filePath } = context.ports.read() as { path: string };
  const resolvedPath = context.resolvePath(filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, JSON.stringify(data, null, 2), 'utf8');
}

async function readAnnotationData(context: {
  ports: { read(): Record<string, unknown> };
  debug(...args: unknown[]): void;
  resolvePath(...segments: string[]): string;
}): Promise<AnnotationData> {
  const { path: filePath } = context.ports.read() as { path: string };
  const resolvedPath = context.resolvePath(filePath);
  context.debug(`reading annotations from "${resolvedPath}"`);
  try {
    const data = JSON.parse(
      await fs.readFile(resolvedPath, { encoding: 'utf8' })
    ) as AnnotationData;
    if (!isObject(data)) {
      context.debug(`annotation file contains invalid data`);
      return {};
    }
    return data;
  } catch (error) {
    // ENOENT is the expected "no annotations yet" path (the file is created
    // on first Save) — stay silent. Anything else (corrupt JSON, perms) is
    // loud, per the codebase's persist-cache convention.
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT')
      context.debug(`error reading annotation file:`, error);
    return {};
  }
}
