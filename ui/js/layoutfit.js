// Picks the layout whose box shapes best match the photos' shapes.
import { LAYOUTS, layoutRects, rectAspect } from "./model.js";

const aspectOf = (m) => Math.max(0.2, Math.min(5, (m.width || 4) / (m.height || 3)));

export function bestLayout(medias, prevLayoutId = null, rng = Math.random) {
  const n = Math.min(9, Math.max(1, medias.length));
  const cands = LAYOUTS.filter((l) => l.n === n && !(n === 1 && l.id === "framed"));
  let best = null;
  for (const l of cands) {
    const rects = layoutRects(l);
    const tileOrder = rects.map((r, i) => [Math.log(rectAspect(r)), i]).sort((a, b) => a[0] - b[0]);
    const medOrder = medias.slice(0, n).map((m, i) => [Math.log(aspectOf(m)), i]).sort((a, b) => a[0] - b[0]);
    let score = 0;
    const order = new Array(n);
    for (let k = 0; k < n; k++) {
      score += Math.abs(tileOrder[k][0] - medOrder[k][0]);
      order[tileOrder[k][1]] = medOrder[k][1];
    }
    score = score / n + rng() * 0.12 + (l.id === prevLayoutId ? 0.2 : 0);
    if (!best || score < best.score) best = { layout: l, order, score };
  }
  return best;
}
