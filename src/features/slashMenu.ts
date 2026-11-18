import type { Completion, CompletionContext, CompletionResult, CompletionSection } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useSettings } from "../stores/settingsStore";

/**
 * The insert menu: typing "/" at the start of an empty line lists the blocks a
 * document is built from (headings, lists, a table, callouts, code, diagrams…),
 * filtered as you type ("/tab" → Table). Choosing one removes the "/…" and runs
 * the same command as the Format menu, so nothing has to be remembered.
 */

export interface SlashItem {
  /** The command that inserts it (see `features/commands`). */
  command: string;
  label: string;
  /** What it looks like in Markdown, shown beside the label. */
  hint: string;
  group: "Text" | "Lists" | "Blocks" | "Callouts" | "Diagrams" | "Insert";
  /** Other words people type for it. */
  words?: string;
}

export const SLASH_ITEMS: SlashItem[] = [
  { command: "heading1", label: "Heading 1", hint: "#", group: "Text", words: "h1 title" },
  { command: "heading2", label: "Heading 2", hint: "##", group: "Text", words: "h2 section" },
  { command: "heading3", label: "Heading 3", hint: "###", group: "Text", words: "h3 subsection" },
  { command: "quote", label: "Quote", hint: ">", group: "Text", words: "blockquote citation" },
  { command: "bulletList", label: "Bulleted List", hint: "- item", group: "Lists", words: "unordered ul points" },
  { command: "orderedList", label: "Numbered List", hint: "1. item", group: "Lists", words: "ordered ol steps" },
  { command: "taskList", label: "Task List", hint: "- [ ] task", group: "Lists", words: "todo checkbox checklist" },
  { command: "table", label: "Table", hint: "| a | b |", group: "Blocks", words: "grid columns rows" },
  { command: "codeBlock", label: "Code Block", hint: "```", group: "Blocks", words: "fence snippet source" },
  { command: "mathBlock", label: "Math Block", hint: "$$", group: "Blocks", words: "formula equation latex" },
  { command: "collapsible", label: "Collapsible Section", hint: "<details>", group: "Blocks", words: "details summary fold spoiler toggle" },
  { command: "horizontalRule", label: "Divider", hint: "---", group: "Blocks", words: "horizontal rule line separator hr" },
  { command: "calloutNote", label: "Note", hint: "> [!NOTE]", group: "Callouts", words: "callout alert info" },
  { command: "calloutTip", label: "Tip", hint: "> [!TIP]", group: "Callouts", words: "callout alert hint" },
  { command: "calloutImportant", label: "Important", hint: "> [!IMPORTANT]", group: "Callouts", words: "callout alert" },
  { command: "calloutWarning", label: "Warning", hint: "> [!WARNING]", group: "Callouts", words: "callout alert" },
  { command: "calloutCaution", label: "Caution", hint: "> [!CAUTION]", group: "Callouts", words: "callout alert danger" },
  { command: "diagramFlowchart", label: "Flowchart", hint: "mermaid", group: "Diagrams", words: "diagram chart flow" },
  { command: "diagramSequence", label: "Sequence Diagram", hint: "mermaid", group: "Diagrams", words: "chart" },
  { command: "diagramGantt", label: "Gantt Chart", hint: "mermaid", group: "Diagrams", words: "diagram timeline plan schedule" },
  { command: "diagramPie", label: "Pie Chart", hint: "mermaid", group: "Diagrams", words: "diagram" },
  { command: "insertImage", label: "Image", hint: "![alt](file)", group: "Insert", words: "picture photo figure" },
  { command: "link", label: "Link", hint: "[text](url)", group: "Insert", words: "url hyperlink" },
  { command: "toc", label: "Table of Contents", hint: "from the headings", group: "Insert", words: "toc index outline" },
  { command: "footnote", label: "Footnote", hint: "[^1]", group: "Insert", words: "note reference" },
  { command: "insertDate", label: "Date", hint: "today", group: "Insert", words: "today" },
  { command: "insertDateTime", label: "Date and Time", hint: "now", group: "Insert", words: "now timestamp" },
  { command: "frontMatter", label: "Front Matter", hint: "title, date, tags", group: "Insert", words: "metadata yaml properties" },
  { command: "insertSnippet", label: "Snippet…", hint: "your own text", group: "Insert", words: "template" },
];

const SECTIONS: Record<SlashItem["group"], CompletionSection> = {
  Text: { name: "Text", rank: 0 },
  Lists: { name: "Lists", rank: 1 },
  Blocks: { name: "Blocks", rank: 2 },
  Callouts: { name: "Callouts", rank: 3 },
  Diagrams: { name: "Diagrams", rank: 4 },
  Insert: { name: "Insert", rank: 5 },
};

/** The items matching what's typed after "/": by the start of a word of the label first, then anywhere in it or its other words. */
export function slashMatches(typed: string): SlashItem[] {
  const query = typed.trim().toLowerCase();
  if (!query) return SLASH_ITEMS;
  const starts = (item: SlashItem) => item.label.toLowerCase().split(/\s+/).some((word) => word.startsWith(query)) || item.label.toLowerCase().startsWith(query);
  const contains = (item: SlashItem) => `${item.label} ${item.words ?? ""}`.toLowerCase().includes(query);
  return [...SLASH_ITEMS.filter(starts), ...SLASH_ITEMS.filter((item) => !starts(item) && contains(item))];
}

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (/Code|FrontMatter|HTMLBlock|CommentBlock/.test(node.name)) return true;
  }
  return false;
}

/** Removes the typed "/…" and runs the item's command where it was. */
function choose(item: SlashItem) {
  return (view: EditorView, _completion: Completion, _from: number, to: number) => {
    const line = view.state.doc.lineAt(to);
    const slash = line.from + line.text.indexOf("/");
    view.dispatch({ changes: { from: slash, to }, selection: { anchor: slash }, userEvent: "delete.slash" });
    // Loaded here: the command registry imports the editor's features, this file among them.
    void import("./commands").then(({ commands }) => commands[item.command]?.run());
  };
}

/**
 * Completion source for the insert menu: only for a "/" that starts an
 * otherwise empty line (after at most three spaces), outside code and front
 * matter, so paths and fractions in running text never open it.
 */
export function slashCompletionSource(ctx: CompletionContext): CompletionResult | null {
  if (!useSettings.getState().settings.slashMenu) return null;
  const m = ctx.matchBefore(/^ {0,3}\/[\p{L}\p{N} ]{0,24}$/u);
  if (!m) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  // Nothing after the cursor on the line either.
  if (line.to !== ctx.pos || inCode(ctx.state, ctx.pos)) return null;
  const slash = m.from + m.text.indexOf("/");
  const typed = m.text.slice(m.text.indexOf("/") + 1);
  // Two spaces in a row, or a space right after the slash: ordinary text, not a search.
  if (/^ | {2}/.test(typed)) return null;
  // Groups for the whole list; a search is one list, best match first.
  const grouped = !typed.trim();
  const options = slashMatches(typed).map(
    (item): Completion => ({ label: item.label, detail: item.hint, ...(grouped ? { section: SECTIONS[item.group] } : {}), apply: choose(item), type: "keyword" }),
  );
  if (!options.length) return null;
  // The list is already filtered and ordered here (it also matches other words for an item).
  return { from: slash + 1, options, filter: false };
}
