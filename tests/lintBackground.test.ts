import { afterEach, describe, expect, it } from "vitest";
import { lintMarkdown } from "../src/features/lint";
import { lintMarkdownAsync, lintsInBackground, setLintWorkerForTests } from "../src/features/lintBackground";
import { LONG_DOCUMENT_CHARS } from "../src/services/limits";

/** A stand-in for the worker: answers like `lintWorker.ts`, a moment later, and records what it was sent. */
function standIn(reply: (text: string) => unknown = (text) => ({ problems: lintMarkdown(text) })) {
  const sent: string[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    onmessageerror: null as (() => void) | null,
    terminated: false,
    postMessage({ id, text }: { id: number; text: string }) {
      sent.push(text);
      setTimeout(() => worker.onmessage?.({ data: { id, ...(reply(text) as object) } } as MessageEvent), 0);
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return { worker, sent };
}

const short = "# Title\n\n#No space after the hash\n";
const long = `${short}\n${"A paragraph of ordinary text.\n\n".repeat(LONG_DOCUMENT_CHARS / 30 + 10)}`;

describe("Markdown checks in the background", () => {
  afterEach(() => setLintWorkerForTests(null));

  it("checks short documents in the window and long ones in the worker, with the same result", async () => {
    expect(lintsInBackground(short.length)).toBe(false);
    expect(lintsInBackground(long.length)).toBe(true);
    const { worker, sent } = standIn();
    setLintWorkerForTests(worker as unknown as Worker);

    expect(await lintMarkdownAsync(short)).toEqual(lintMarkdown(short));
    expect(sent).toEqual([]);

    const problems = await lintMarkdownAsync(long);
    expect(sent).toEqual([long]);
    expect(problems).toEqual(lintMarkdown(long));
    expect(problems.length).toBeGreaterThan(0);
  });

  it("answers each request with its own text's problems, whatever the order", async () => {
    const { worker } = standIn();
    setLintWorkerForTests(worker as unknown as Worker);
    const other = long.replace("#No space after the hash", "Fine now");
    const [a, b] = await Promise.all([lintMarkdownAsync(long), lintMarkdownAsync(other)]);
    expect(a).toEqual(lintMarkdown(long));
    expect(b).toEqual(lintMarkdown(other));
    expect(a).not.toEqual(b);
  });

  it("does the work in the window when the worker fails, for this and later requests", async () => {
    const { worker, sent } = standIn(() => ({ error: "boom" }));
    setLintWorkerForTests(worker as unknown as Worker);
    expect(await lintMarkdownAsync(long)).toEqual(lintMarkdown(long));
    expect(worker.terminated).toBe(true);
    expect(await lintMarkdownAsync(long)).toEqual(lintMarkdown(long));
    expect(sent.length).toBe(1);
  });

  it("works without workers at all", async () => {
    setLintWorkerForTests(null);
    expect(await lintMarkdownAsync(long)).toEqual(lintMarkdown(long));
  });
});
