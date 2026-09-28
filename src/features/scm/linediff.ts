// The diff page's line diff (DiffView.diff in EditorArea.swift): Swift takes
// `b.difference(from: a)` (a Myers diff), collects the removed offsets of `a` and the
// inserted offsets of `b`, then walks both, putting a removal before an insertion.

export type DiffLine = { kind: "+" | "-" | " "; text: string };

/** Beyond this many edits the script falls back to "all removed, then all inserted" for the
 *  differing middle (the frontiers kept for the walk back grow with the square of it). */
const MAX_EDITS = 3000;

/** Removed indices of `a` and inserted indices of `b` of a shortest edit script (Myers). */
export function editScript(a: string[], b: string[]): { removed: Set<number>; inserted: Set<number> } {
  const removed = new Set<number>(), inserted = new Set<number>();
  // The common prefix and suffix never change.
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length, eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - lo, m = eb - lo, max = n + m;
  if (!max) return { removed, inserted };
  const A = (i: number) => a[lo + i], B = (j: number) => b[lo + j];
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = []; // trace[d] = v[off-d-1 .. off+d+1] before step d
  let done = false;
  for (let d = 0; d <= Math.min(max, MAX_EDITS) && !done; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A(x) === B(y)) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { done = true; break; }
    }
  }
  if (!done) {
    for (let i = 0; i < n; i++) removed.add(lo + i);
    for (let j = 0; j < m; j++) inserted.add(lo + j);
    return { removed, inserted };
  }
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const t = trace[d], at = (k: number) => t[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(prevK), py = px - prevK;
    while (x > px && y > py) { x--; y--; }
    if (x === px) inserted.add(lo + py); else removed.add(lo + px);
    x = px; y = py;
  }
  return { removed, inserted };
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const { removed, inserted } = editScript(a, b);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && removed.has(i)) { out.push({ kind: "-", text: a[i] }); i++; }
    else if (j < b.length && inserted.has(j)) { out.push({ kind: "+", text: b[j] }); j++; }
    else { if (j < b.length) out.push({ kind: " ", text: b[j] }); i++; j++; }
  }
  return out;
}
