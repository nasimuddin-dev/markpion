export type DiffLine = { kind: "same" | "add" | "del"; text: string; oldNo?: number; newNo?: number };
export type DiffRow = DiffLine | { kind: "gap"; hidden: number };

const MAX_CELLS = 4_000_000;
/** Changed lines the edit-script search gives up after (its memory grows with the square of this). */
const MAX_EDITS = 2000;

/**
 * The shortest edit script from `a` to `b` (Myers' greedy algorithm): its time
 * and memory depend on how many lines differ, not on how long the texts are,
 * so a few edits far apart in a long document compare quickly. Returns one
 * entry per step, in order: 0 a line in both, 1 a line only in `a`, 2 a line
 * only in `b` (SAME, DEL and ADD below); or null when more than `maxEdits`
 * lines differ.
 */
function editScript(a: string[], b: string[], maxEdits: number): Uint8Array | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  // v[k + max + 1]: the furthest x reached on diagonal k (x - y = k).
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(max + 1 - d, max + 2 + d));
    for (let k = -d; k <= d; k += 2) {
      const i = k + max + 1;
      let x = k === -d || (k !== d && v[i - 1] < v[i + 1]) ? v[i + 1] : v[i - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[i] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  // Walk back from the end; the steps come out last to first.
  const steps = new Uint8Array(n + m);
  let count = 0;
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const before = trace[d];
    const k = x - y;
    const at = (diagonal: number) => before[diagonal + d];
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps[count++] = 0;
      x--;
      y--;
    }
    steps[count++] = x === prevX ? 2 : 1;
    x = prevX;
    y = prevY;
  }
  for (; x > 0; x--) steps[count++] = 0;
  return steps.subarray(0, count).reverse();
}

/** A step of a comparison: a line in both texts, only in the old one, or only in the new one. */
const SAME = 0;
const DEL = 1;
const ADD = 2;

/** The changed middle of two texts: what's between the lines they start and end with alike. */
export interface LineChanges {
  /** Lines the texts start with alike. */
  start: number;
  /** Where the lines they end with alike begin, in the old and in the new text. */
  endA: number;
  endB: number;
  /** The steps (SAME, DEL, ADD) through the lines between, in order. */
  steps: Uint8Array;
}

/**
 * Compares two texts line by line. A small changed part is compared with an
 * LCS table (up to `maxCells` cells); a larger one by its shortest edit
 * script, as long as at most `maxEdits` lines differ. Returns `null` when the
 * texts differ too much to diff interactively.
 */
export function lineChanges(A: string[], B: string[], maxCells = MAX_CELLS, maxEdits = MAX_EDITS): LineChanges | null {
  // Trim common prefix/suffix first; most edits are local.
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (!n || !m) return { start, endA, endB, steps: new Uint8Array(n + m).fill(n ? DEL : ADD) };
  const a2 = A.slice(start, endA);
  const b2 = B.slice(start, endB);
  if (n * m > maxCells) {
    const script = editScript(a2, b2, maxEdits);
    if (!script) return null;
    // Within a changed block the removed lines come first, as in `git diff`.
    for (let i = 0; i < script.length; ) {
      if (script[i] === SAME) {
        i++;
        continue;
      }
      let to = i;
      let removed = 0;
      for (; to < script.length && script[to] !== SAME; to++) if (script[to] === DEL) removed++;
      script.fill(DEL, i, i + removed).fill(ADD, i + removed, to);
      i = to;
    }
    return { start, endA, endB, steps: script };
  }

  // LCS table over the differing middle.
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const steps = new Uint8Array(n + m);
  let count = 0;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a2[i] === b2[j]) {
      steps[count++] = SAME;
      i++;
      j++;
      // On a tie the removed line comes first, as in `git diff`.
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      steps[count++] = DEL;
      i++;
    } else {
      steps[count++] = ADD;
      j++;
    }
  }
  return { start, endA, endB, steps: steps.subarray(0, count) };
}

/**
 * Line diff. `a` is the old text, `b` the new one. Returns `null` when the
 * texts differ too much to diff interactively (see `lineChanges`).
 */
export function diffLines(a: string, b: string, maxCells = MAX_CELLS, maxEdits = MAX_EDITS): DiffLine[] | null {
  const A = a.split("\n");
  const B = b.split("\n");
  const changes = lineChanges(A, B, maxCells, maxEdits);
  if (!changes) return null;
  const { start, endA, endB, steps } = changes;
  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ kind: "same", text: A[k], oldNo: k + 1, newNo: k + 1 });
  let i = start;
  let j = start;
  for (const step of steps) {
    if (step === DEL) out.push({ kind: "del", text: A[i], oldNo: ++i });
    else if (step === ADD) out.push({ kind: "add", text: B[j], newNo: ++j });
    else out.push({ kind: "same", text: A[i], oldNo: ++i, newNo: ++j });
  }
  for (let k = 0; k < A.length - endA; k++) {
    out.push({ kind: "same", text: A[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  return out;
}

/** Collapses unchanged runs, keeping `context` lines around each change. */
export function withContext(lines: DiffLine[], context = 3): DiffRow[] {
  const changed = lines.map((l) => l.kind !== "same");
  const keep = lines.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) if (changed[k]) return true;
    return false;
  });
  const rows: DiffRow[] = [];
  let hidden = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (hidden) rows.push({ kind: "gap", hidden });
      hidden = 0;
      rows.push(l);
    } else hidden++;
  });
  if (hidden) rows.push({ kind: "gap", hidden });
  return rows;
}

export function diffStats(lines: DiffLine[]) {
  return {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "del").length,
  };
}

/** A piece of a changed line; `changed` pieces differ from the paired line. */
export interface Segment {
  text: string;
  changed: boolean;
}

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/**
 * Word-level differences between an old and a new version of a line: runs of
 * words, spaces or punctuation that aren't in both. `null` when the lines
 * share too little for a word diff to help (under a third of their words), or
 * are too long.
 */
export function wordDiff(a: string, b: string, maxCells = 250_000): { old: Segment[]; new: Segment[] } | null {
  const A = a.match(TOKEN) ?? [];
  const B = b.match(TOKEN) ?? [];
  if (!A.length || !B.length || A.length * B.length > maxCells) return null;
  const dp = Array.from({ length: A.length + 1 }, () => new Uint32Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const words = (tokens: string[]) => tokens.filter((t) => t.trim()).length;
  const common: string[] = [];
  const oldSeg: Segment[] = [];
  const newSeg: Segment[] = [];
  const push = (list: Segment[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) {
      common.push(A[i]);
      push(oldSeg, A[i++], false);
      push(newSeg, B[j++], false);
    } else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) push(newSeg, B[j++], true);
    else push(oldSeg, A[i++], true);
  }
  if (words(common) * 3 < Math.max(words(A), words(B))) return null;
  return { old: oldSeg, new: newSeg };
}

/**
 * Word diffs for changed lines: in each run of changed lines, the k-th
 * removed line is paired with the k-th added one.
 */
export function pairedWordDiffs(lines: DiffLine[]): Map<DiffLine, Segment[]> {
  const out = new Map<DiffLine, Segment[]>();
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind === "same") {
      i++;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].kind !== "same") end++;
    const run = lines.slice(i, end);
    const removed = run.filter((l) => l.kind === "del");
    const added = run.filter((l) => l.kind === "add");
    for (let k = 0; k < Math.min(removed.length, added.length); k++) {
      const diff = wordDiff(removed[k].text, added[k].text);
      if (!diff) continue;
      out.set(removed[k], diff.old);
      out.set(added[k], diff.new);
    }
    i = end;
  }
  return out;
}
