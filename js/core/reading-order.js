// Approximate reading order (FD-5): rows from top to bottom, left to right within a row.

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * A new row starts when a face's vertical centre differs from the current row's average by more
 * than 0.6 times the median face height.
 * @template {{box:{x:number,y:number,w:number,h:number}}} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function readingOrder(items) {
  if (items.length < 2) return [...items];
  const rowGap = 0.6 * median(items.map((it) => it.box.h));
  const pts = items
    .map((item) => ({ item, cx: item.box.x + item.box.w / 2, cy: item.box.y + item.box.h / 2 }))
    .sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const p of pts) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(p.cy - row.avg) <= rowGap) {
      row.pts.push(p);
      row.avg = mean(row.pts.map((q) => q.cy));
    } else rows.push({ pts: [p], avg: p.cy });
  }
  return rows.flatMap((r) => r.pts.sort((a, b) => a.cx - b.cx).map((p) => p.item));
}
