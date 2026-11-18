/// <reference lib="webworker" />
import { lintMarkdown } from "./lint";

/**
 * The Markdown checks off the main thread, for long documents: the checks read
 * the whole text, which takes long enough there to hold up typing when run in
 * the window. One request at a time; the reply carries the request's id.
 */
self.onmessage = (event: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = event.data;
  try {
    self.postMessage({ id, problems: lintMarkdown(text) });
  } catch (e) {
    self.postMessage({ id, error: String((e as Error)?.message ?? e) });
  }
};
