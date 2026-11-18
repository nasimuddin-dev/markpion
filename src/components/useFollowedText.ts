import { useDeferredValue, useEffect, useState } from "react";
import { LARGE_DOCUMENT_CHARS, LONG_DOCUMENT_CHARS } from "../services/limits";

/** How long typing must pause before the views of a long, and of a large, document catch up. */
const LONG_PAUSE_MS = 250;
const LARGE_PAUSE_MS = 2000;

/**
 * The document's text for views worked out from the whole of it (the outline,
 * the breadcrumbs, the status bar's counts). Normally it follows the document
 * at a lower priority than typing (React defers it). Above LONG_DOCUMENT_CHARS
 * scanning the text takes long enough to feel while typing, so it catches up
 * once typing pauses; above LARGE_DOCUMENT_CHARS after a longer pause. Another
 * document (`docId`) is shown at once.
 */
export function useFollowedText(text: string | undefined, docId: string | null | undefined): string | undefined {
  const deferred = useDeferredValue(text);
  const long = text !== undefined && text.length > LONG_DOCUMENT_CHARS;
  const [settled, setSettled] = useState({ text, docId });
  useEffect(() => {
    if (!long) return;
    const timer = setTimeout(() => setSettled({ text, docId }), text.length > LARGE_DOCUMENT_CHARS ? LARGE_PAUSE_MS : LONG_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, docId, long]);
  if (!long) return deferred;
  return settled.docId === docId && settled.text !== undefined ? settled.text : text;
}
