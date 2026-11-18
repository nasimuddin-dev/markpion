import { LONG_DOCUMENT_CHARS } from "../services/limits";
import { lintMarkdown, type MarkdownProblem } from "./lint";

/**
 * The Markdown checks for the editor: in the window for ordinary documents
 * (they take a few milliseconds), and in a web worker for long ones, where
 * reading the whole text would hold up typing each time it pauses. Without
 * workers (tests, or a host that refuses them) everything runs in the window.
 */

type Reply = { id: number; problems?: MarkdownProblem[]; error?: string };

let worker: Worker | null = null;
/** Set once a worker can't be started or fails: the window does the work from then on. */
let unavailable = typeof Worker === "undefined";
let nextId = 1;
let answered = false;
/** The performance mark set when the worker first answers. */
export const WORKER_MARK = "markpion:lint-in-worker";
const waiting = new Map<number, { text: string; resolve: (problems: MarkdownProblem[]) => void }>();

/** Answers every request in the window (the worker is gone). */
function fallBack() {
  unavailable = true;
  worker?.terminate();
  worker = null;
  for (const [id, { text, resolve }] of waiting) {
    waiting.delete(id);
    resolve(lintMarkdown(text));
  }
}

/** Takes the worker's replies; anything unexpected ends its use. */
function attach(w: Worker): Worker {
  w.onmessage = (event: MessageEvent<Reply>) => {
    const { id, problems } = event.data;
    const request = waiting.get(id);
    if (!request) return;
    if (!problems) return fallBack();
    waiting.delete(id);
    // A mark for diagnostics (and the native test): the worker did answer in this host.
    if (!answered && typeof performance !== "undefined") performance.mark?.(WORKER_MARK);
    answered = true;
    request.resolve(problems);
  };
  w.onerror = fallBack;
  w.onmessageerror = fallBack;
  return w;
}

function start(): Worker | null {
  if (worker || unavailable) return worker;
  try {
    worker = attach(new Worker(new URL("./lintWorker.ts", import.meta.url), { type: "module" }));
  } catch {
    unavailable = true;
    worker = null;
  }
  return worker;
}

/** Whether a document of this length is checked in the worker. */
export const lintsInBackground = (length: number) => length > LONG_DOCUMENT_CHARS;

/** The problems `lintMarkdown` finds in `text`, worked out without holding up the window when the text is long. */
export function lintMarkdownAsync(text: string): Promise<MarkdownProblem[]> {
  const background = lintsInBackground(text.length) ? start() : null;
  if (!background) return Promise.resolve(lintMarkdown(text));
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, { text, resolve });
    try {
      background.postMessage({ id, text });
    } catch {
      fallBack();
    }
  });
}

/** Test helper: puts a stand-in for the worker in place (null: back to none started). */
export function setLintWorkerForTests(standIn: Worker | null) {
  waiting.clear();
  worker = standIn ? attach(standIn) : null;
  unavailable = standIn ? false : typeof Worker === "undefined";
}
