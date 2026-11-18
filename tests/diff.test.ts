import { describe, expect, it } from "vitest";
import { diffLines, type DiffLine } from "../src/features/diff";
import { changeCounts, changeHunks, changeMarkers } from "../src/features/gitGutter";

const oldText = (lines: DiffLine[]) => lines.filter((l) => l.kind !== "add").map((l) => l.text).join("\n");
const newText = (lines: DiffLine[]) => lines.filter((l) => l.kind !== "del").map((l) => l.text).join("\n");
const kept = (lines: DiffLine[]) => lines.filter((l) => l.kind === "same").length;

/** Checks that the diff rebuilds both texts and numbers their lines in order. */
function expectValid(lines: DiffLine[], a: string, b: string) {
  expect(oldText(lines)).toBe(a);
  expect(newText(lines)).toBe(b);
  expect(lines.filter((l) => l.kind !== "add").map((l) => l.oldNo)).toEqual(a.split("\n").map((_, i) => i + 1));
  expect(lines.filter((l) => l.kind !== "del").map((l) => l.newNo)).toEqual(b.split("\n").map((_, i) => i + 1));
}

describe("line diff", () => {
  it("finds the same number of unchanged lines by edit script as by table", () => {
    let seed = 11;
    const next = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let round = 0; round < 200; round++) {
      // Few distinct lines, so many alignments are possible.
      const text = (length: number) => Array.from({ length }, () => "abcdef"[next(6)]).join("\n");
      const a = text(next(30));
      const b = text(next(30));
      const byTable = diffLines(a, b)!;
      // No table cells allowed: the edit script does the whole comparison.
      const byScript = diffLines(a, b, 0)!;
      expectValid(byTable, a, b);
      expectValid(byScript, a, b);
      expect(kept(byScript), `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(kept(byTable));
    }
  });

  it("puts removed lines before added ones in a changed block", () => {
    expect(diffLines("a\nb\nc\nd", "a\nx\ny\nd", 0)!.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:a", "del:b", "del:c", "add:x", "add:y", "same:d"]);
  });

  it("compares a long document with edits far apart, and gives up when too much differs", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const a = lines.join("\n");
    const edited = [...lines];
    edited[3] = "changed near the top";
    edited.splice(10_000, 2);
    edited.push("added at the end");
    const b = edited.join("\n");
    // 20,000 × 20,000 lines is far beyond the table's size.
    const diff = diffLines(a, b)!;
    expectValid(diff, a, b);
    expect(diff.filter((l) => l.kind !== "same").map((l) => `${l.kind}:${l.text}`)).toEqual([
      "del:line 3", "add:changed near the top", "del:line 10000", "del:line 10001", "add:added at the end",
    ]);
    const other = Array.from({ length: 20_000 }, (_, i) => `other ${i}`).join("\n");
    expect(diffLines(a, other)).toBeNull();
  });
});

describe("Git change bars in a long document", () => {
  it("still marks edits that are thousands of lines apart", () => {
    const lines = Array.from({ length: 8000 }, (_, i) => `line ${i}`);
    const edited = [...lines];
    edited[1] = "changed at the top";
    edited[7990] = "changed at the bottom";
    edited.splice(4000, 0, "added in the middle");
    const hunks = changeHunks(lines.join("\n"), edited.join("\n"))!;
    expect(changeCounts(hunks)).toEqual({ added: 1, changed: 2, deleted: 0 });
    expect([...changeMarkers(lines.join("\n"), edited.join("\n"))!]).toEqual([[2, "modified"], [4001, "added"], [7992, "modified"]]);
  });
});
