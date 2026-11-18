import { describe, expect, it, vi } from "vitest";
import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commands } from "../src/features/commands";
import { applyCommand, insertCollapsible } from "../src/features/formatting";
import { SLASH_ITEMS, slashCompletionSource, slashMatches } from "../src/features/slashMenu";
import { useSettings } from "../src/stores/settingsStore";

/** The menu for a document with the cursor at `|`. */
function menuAt(text: string) {
  const pos = text.indexOf("|");
  const state = EditorState.create({ doc: text.replace("|", ""), extensions: [markdown({ base: markdownLanguage })] });
  return { state, pos, result: slashCompletionSource(new CompletionContext(state, pos, false)) };
}
const labels = (text: string) => menuAt(text).result?.options.map((o) => o.label) ?? null;

describe("insert menu (/)", () => {
  it("lists every block, in groups, for a slash on an empty line", () => {
    const { result, pos } = menuAt("# Title\n\n/|");
    expect(result!.options.map((o) => o.label)).toEqual(SLASH_ITEMS.map((i) => i.label));
    expect(result!.from).toBe(pos);
    expect([...new Set(result!.options.map((o) => (typeof o.section === "object" ? o.section.name : o.section)))]).toEqual(["Text", "Lists", "Blocks", "Callouts", "Diagrams", "Insert"]);
    // Every item runs a command that exists.
    expect(SLASH_ITEMS.filter((i) => !commands[i.command]).map((i) => i.command)).toEqual([]);
  });

  it("narrows as you type, by the label first and then by other words for it", () => {
    expect(labels("/tab|")).toEqual(["Table", "Table of Contents"]);
    expect(labels("/todo|")).toEqual(["Task List"]);
    expect(labels("  /head|")).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(labels("/numbered l|")).toEqual(["Numbered List"]);
    expect(slashMatches("chart").map((i) => i.label)).toEqual(["Gantt Chart", "Pie Chart", "Flowchart", "Sequence Diagram"]);
    expect(labels("/zzz|")).toBeNull();
  });

  it("stays out of the way in running text, code, front matter and when turned off", () => {
    expect(labels("either/|")).toBeNull();
    expect(labels("see /usr|")).toBeNull();
    expect(labels("/| and more")).toBeNull();
    expect(labels("- /|")).toBeNull();
    expect(labels("/ |")).toBeNull();
    expect(labels("```\n/|\n```")).toBeNull();
    expect(labels("     /|")).toBeNull();
    useSettings.getState().update({ slashMenu: false });
    expect(labels("/|")).toBeNull();
    useSettings.getState().update({ slashMenu: true });
    expect(labels("/|")).not.toBeNull();
  });

  it("removes the typed text and runs the command", async () => {
    const run = vi.spyOn(commands.table, "run").mockImplementation(() => {});
    const { state, pos, result } = menuAt("Intro\n\n  /tab|\n\nAfter");
    const view = new EditorView({ state });
    const table = result!.options[0];
    (table.apply as (view: EditorView, c: Completion, from: number, to: number) => void)(view, table, result!.from, pos);
    expect(view.state.doc.toString()).toBe("Intro\n\n  \n\nAfter");
    expect(view.state.selection.main.head).toBe("Intro\n\n  ".length);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    view.destroy();
  });
});

describe("collapsible section", () => {
  it("wraps the selection, with the title selected to type over", () => {
    const start = EditorState.create({ doc: "Before\n\nSecret text\n\nAfter", selection: { anchor: 8, head: 19 } });
    const next = applyCommand(start, insertCollapsible);
    expect(next.doc.toString()).toBe("Before\n\n<details>\n<summary>Details</summary>\n\nSecret text\n\n</details>\n\n\nAfter");
    expect(next.sliceDoc(next.selection.main.from, next.selection.main.to)).toBe("Details");
    const empty = applyCommand(EditorState.create({ doc: "" }), insertCollapsible);
    expect(empty.doc.toString()).toBe("<details>\n<summary>Details</summary>\n\nHidden until the reader opens it.\n\n</details>\n");
  });
});
