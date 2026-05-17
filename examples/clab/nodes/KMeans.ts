/**
 * A naive custom clustering node — written the way an AI would on first pass:
 * it assumes the cluster fields are top-level on each row. But ImportBGGData
 * rows are { id, document } where `document` is a JSON *string*. So x.weight
 * and x.rating are `undefined` -> NaN -> the node throws. The realistic bug.
 */
export const KMeans = {
  category: 'Data',
  async *process(ctx: any) {
    const { data, k = 3, on = ['weight', 'rating'] } = ctx.ports.read();
    const rows: any[] = Array.isArray(data) ? data : [];
    const pts = rows.map(r => on.map((f: string) => Number(r[f])));
    if (pts.some((p: number[]) => p.some(Number.isNaN)))
      throw new Error(
        `KMeans: non-numeric coordinate (fields ${JSON.stringify(on)})`
      );
    // toy 1-iteration k-means
    const centroids = pts.slice(0, k);
    const out = rows.map((r, i) => {
      let best = 0,
        bd = Infinity;
      centroids.forEach((c, ci) => {
        const d = c.reduce(
          (s: number, v: number, j: number) => s + (v - pts[i][j]) ** 2,
          0
        );
        if (d < bd) (bd = d), (best = ci);
      });
      return { ...r, cluster: best, _x: pts[i][0], _y: pts[i][1] };
    });
    ctx.ports.write({ data: out });
    return `Clustered ${out.length} rows into ${k}`;
  },
};
