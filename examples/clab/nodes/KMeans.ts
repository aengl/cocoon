/**
 * A naive custom clustering node — written the way an AI would on first pass:
 * it assumes the cluster fields are top-level on each row. But ImportBGGData
 * rows are { id, document } where `document` is a JSON *string*. So x.weight
 * and x.rating are `undefined` -> NaN -> the node throws. The realistic bug.
 *
 * Co-evolution (keystone 5/6): the knobs that *steer* the clustering — how
 * many clusters, which distance, whether to normalise — are no longer `in:`
 * params but **code-declared steering controls**. The cocoon.yml's `k: 3` is
 * now an inert literal (the default matches), making the point literally:
 * the YAML is wiring, the node's code is the flow. Setting a control is a
 * session override → the node goes `stale` → you re-pull. Zero side-effects.
 */
export const KMeans = {
  category: 'Data',
  controls: {
    k: {
      kind: 'number',
      label: 'clusters (k)',
      default: 3,
      min: 1,
      max: 8,
      step: 1,
    },
    metric: {
      kind: 'select',
      label: 'distance',
      options: ['euclidean', 'manhattan'],
      default: 'euclidean',
    },
    normalize: { kind: 'toggle', label: 'z-score normalise', default: false },
  },
  async *process(ctx: any) {
    const { data, on = ['weight', 'rating'] } = ctx.ports.read();
    const { k, metric, normalize } = ctx.controls.read();
    const rows: any[] = Array.isArray(data) ? data : [];
    const pts: number[][] = rows.map(r => on.map((f: string) => Number(r[f])));
    if (pts.some((p: number[]) => p.some(Number.isNaN)))
      throw new Error(
        `KMeans: non-numeric coordinate (fields ${JSON.stringify(on)})`
      );

    // z-score per dimension — a steering toggle, off by default (so the
    // default path is bit-identical to the original squared-euclidean run).
    if (normalize && pts.length) {
      const dims = pts[0].length;
      for (let j = 0; j < dims; j++) {
        const col = pts.map(p => p[j]);
        const mean = col.reduce((s, v) => s + v, 0) / col.length;
        const sd =
          Math.sqrt(
            col.reduce((s, v) => s + (v - mean) ** 2, 0) / col.length
          ) || 1;
        for (const p of pts) p[j] = (p[j] - mean) / sd;
      }
    }

    const dist =
      metric === 'manhattan'
        ? (a: number[], b: number[]) =>
            a.reduce((s, v, j) => s + Math.abs(v - b[j]), 0)
        : (a: number[], b: number[]) =>
            a.reduce((s, v, j) => s + (v - b[j]) ** 2, 0);

    // toy 1-iteration k-means
    const centroids = pts.slice(0, k);
    const out = rows.map((r, i) => {
      let best = 0,
        bd = Infinity;
      centroids.forEach((c, ci) => {
        const d = dist(c, pts[i]);
        if (d < bd) (bd = d), (best = ci);
      });
      return { ...r, cluster: best, _x: pts[i][0], _y: pts[i][1] };
    });
    ctx.ports.write({ data: out });
    return `Clustered ${out.length} rows into ${k} (${metric}${
      normalize ? ', normalised' : ''
    })`;
  },
};
