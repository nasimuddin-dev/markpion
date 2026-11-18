import { describe, expect, it } from "vitest";
import { diffLines } from "../src/features/diff";
import { extractHeadings } from "../src/features/outline";
import { protectedLines, referenceDefinitions, scanLines, splitSections } from "../src/services/markdownSections";

describe("one scan of a long document", () => {
  const section = (i: number) => `## Section ${i}\n\nText ${i}.\n\n\`\`\`\n# not a heading ${i}\n\`\`\`\n\n[ref${i}]: https://example.com/${i}\n\n`;
  const long = Array.from({ length: 900 }, (_, i) => section(i)).join("");

  it("is kept for the preview's and the outline's readers of the same text", () => {
    expect(long.length).toBeGreaterThan(50_000);
    const scan = scanLines(long);
    expect(scan.lines).toEqual(long.split("\n"));
    expect(scan.shielded).toEqual(protectedLines(long.split("\n")));
    // The same text again: the same arrays, not a second scan.
    expect(scanLines(long)).toBe(scan);
    expect(splitSections(long).map((s) => s.source).join("")).toBe(long);
    expect(referenceDefinitions(long).split("\n").length).toBe(900);
    expect(extractHeadings(long).length).toBe(900);
    expect(scanLines(long)).toBe(scan);
  });

  it("isn't kept for short texts, and never answers for another text", () => {
    const short = section(1);
    expect(scanLines(short)).not.toBe(scanLines(short));
    const scan = scanLines(long);
    const edited = `${long}## One more\n`;
    expect(scanLines(edited)).not.toBe(scan);
    expect(extractHeadings(edited).length).toBe(901);
    expect(extractHeadings(long).length).toBe(900);
  });
});

describe("line diff of texts of very different length", () => {
  it("gives up at once when one has more extra lines than changes are allowed", () => {
    const lines = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`).join("\n");
    // 30 lines against 5,000 others: at least 4,970 changes, over the 600 allowed.
    expect(diffLines(lines(30, "a"), lines(5000, "b"), 60_000, 600)).toBeNull();
    // Within the allowance it's still compared.
    const base = lines(5000, "x");
    expect(diffLines(base, `${base}\n${lines(500, "new")}`, 0, 600)!.filter((l) => l.kind === "add").length).toBe(500);
  });
});
