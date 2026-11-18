import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useDocuments } from "../stores/documentsStore";
import { useUi } from "../stores/uiStore";
import { useSettings } from "../stores/settingsStore";
import { currentHeadingIndex, headingSlugs, headingsOf, sameHeadings, type Heading } from "../features/outline";
import { moveSectionAtLine, moveSectionTo, selectSection, setDocumentText } from "../features/sections";
import { copyText } from "../features/pathActions";
import { ContextMenu } from "./ContextMenu";
import { revealLine, runOnEditor } from "../features/editorBridge";
import { renameHeading } from "../features/renameHeading";
import { Icon } from "./Icon";
import { mountAllChunks } from "./PreviewChunks";
import { useFollowedText } from "./useFollowedText";

/** Scrolls the preview to the n-th heading. */
function revealInPreview(index: number) {
  mountAllChunks();
  const headings = document.querySelectorAll<HTMLElement>(".markdown-body :is(h1,h2,h3,h4,h5,h6)");
  headings[index]?.scrollIntoView({ block: "start" });
}

/** Shows the n-th heading (at line `h.line`) in the editor and the preview, as the view mode allows. */
export function goToHeading(h: Heading, index: number) {
  const viewMode = useSettings.getState().settings.viewMode;
  if (viewMode !== "preview") revealLine(h.line);
  if (viewMode !== "editor") revealInPreview(index);
}

const NO_HEADINGS: Heading[] = [];

interface RowActions {
  activate(index: number): void;
  pointerDown(e: ReactPointerEvent<HTMLButtonElement>, index: number): void;
  keyDown(e: KeyboardEvent<HTMLButtonElement>, index: number): void;
  contextMenu(e: MouseEvent<HTMLButtonElement>, index: number): void;
  toggle(index: number): void;
}

/** One heading in the outline. Memoized: a long document has thousands, and typing changes at most a few. */
const OutlineRow = memo(function OutlineRow({ index, level, text, line, indent, current, expandable, closed, dragging, dropBefore, actions }: {
  index: number;
  level: number;
  text: string;
  line: number;
  indent: number;
  current: boolean;
  expandable: boolean;
  closed: boolean;
  dragging: boolean;
  dropBefore: boolean;
  actions: RowActions;
}) {
  return (
    <li>
      <button
        aria-expanded={expandable ? !closed : undefined}
        data-outline-index={index}
        className={`outline-item${current ? " current" : ""}${dragging ? " dragging" : ""}${dropBefore ? " drop-before" : ""}`}
        style={{ paddingLeft: indent }}
        aria-current={current ? "location" : undefined}
        title={`${text} (line ${line}). Drag, or press Alt+Up/Down, to move the section`}
        onClick={() => actions.activate(index)}
        onPointerDown={(e) => actions.pointerDown(e, index)}
        onKeyDown={(e) => actions.keyDown(e, index)}
        onContextMenu={(e) => actions.contextMenu(e, index)}
      >
        {expandable ? (
          <span
            className="outline-toggle"
            aria-hidden="true"
            title={closed ? "Expand (Right arrow)" : "Collapse (Left arrow)"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              actions.toggle(index);
            }}
          >
            <Icon name={closed ? "chevronRight" : "chevronDown"} size={12} />
          </span>
        ) : (
          <span className="outline-toggle" aria-hidden="true" />
        )}
        <span className="outline-level" aria-hidden="true">H{level}</span>
        <span className="outline-text">{text}</span>
      </button>
    </li>
  );
});

/** Document outline: navigable list of headings for the active document. */
export function Outline() {
  const docId = useDocuments((s) => s.activeId);
  const content = useDocuments((s) => s.docs.find((d) => d.id === s.activeId)?.content);
  const deferred = useFollowedText(content, docId);
  const collapsed = useSettings((s) => !s.settings.showOutline);
  // Typing in a paragraph leaves the headings as they are: the list keeps the same array, so its rows don't render again.
  const lastHeadings = useRef<Heading[]>(NO_HEADINGS);
  const headings = useMemo(() => {
    const next = deferred && !collapsed ? headingsOf(deferred) : NO_HEADINGS;
    if (!sameHeadings(lastHeadings.current, next)) lastHeadings.current = next;
    return lastHeadings.current;
  }, [deferred, collapsed]);
  const cursorLine = useUi((s) => s.cursor.line);
  const current = currentHeadingIndex(headings, cursorLine);
  const update = useSettings((s) => s.update);
  const list = useRef<HTMLUListElement>(null);
  const minLevel = headings.reduce((m, h) => Math.min(m, h.level), 6);
  const slugs = useMemo(() => headingSlugs(headings), [headings]);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  /** Collapsed sections, by heading anchor; subheadings of a collapsed heading aren't listed. */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setClosed(new Set()), [docId]);
  const hasChildren = (i: number) => (headings[i + 1]?.level ?? 0) > headings[i].level;
  const toggle = (i: number, open?: boolean) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (open ?? next.has(slugs[i])) next.delete(slugs[i]);
      else next.add(slugs[i]);
      return next;
    });
  const visible = useMemo(() => {
    const shown: number[] = [];
    let hiddenBelow = 0;
    headings.forEach((h, i) => {
      if (hiddenBelow && h.level > hiddenBelow) return;
      hiddenBelow = 0;
      shown.push(i);
      if (closed.has(slugs[i])) hiddenBelow = h.level;
    });
    return shown;
  }, [headings, slugs, closed]);
  /** After a keyboard move, focus follows the moved heading. */
  const refocus = useRef<{ text: string; level: number } | null>(null);

  useEffect(() => {
    const target = refocus.current;
    if (!target || !list.current) return;
    const index = headings.findIndex((h) => h.text === target.text && h.level === target.level);
    if (index >= 0) {
      refocus.current = null;
      list.current.querySelector<HTMLButtonElement>(`[data-outline-index="${index}"]`)?.focus();
    }
  }, [headings]);

  const move = (index: number, direction: -1 | 1) => {
    const h = headings[index];
    if (!docId || !h) return false;
    refocus.current = { text: h.text, level: h.level };
    const moved = moveSectionAtLine(docId, h.line, direction);
    if (!moved) refocus.current = null;
    return moved;
  };

  /** Dragging a heading: `dropIndex` is the heading it will go before, or headings.length for the end. */
  const drag = useRef<{ index: number; y: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<{ from: number; drop: number | null } | null>(null);

  const dropTarget = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-outline-index]");
    if (el) return Number(el.dataset.outlineIndex);
    const r = list.current?.getBoundingClientRect();
    return r && y > r.bottom - 4 && x >= r.left && x <= r.right ? headings.length : null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (e.button !== 0) return;
    drag.current = { index, y: e.clientY, active: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.active && Math.abs(ev.clientY - d.y) < 5) return;
      d.active = true;
      setDragging({ from: d.index, drop: dropTarget(ev.clientX, ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      setDragging(null);
      if (!d?.active) return;
      suppressClick.current = true;
      const drop = dropTarget(ev.clientX, ev.clientY);
      const text = useDocuments.getState().docs.find((doc) => doc.id === docId)?.content;
      if (drop === null || text === undefined || !docId) return;
      const next = moveSectionTo(text, headings[d.index].line, drop < headings.length ? headings[drop].line : null);
      if (next !== null) {
        refocus.current = { text: headings[d.index].text, level: headings[d.index].level };
        setDocumentText(docId, next);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onItemKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(index, e.key === "ArrowUp" ? -1 : 1);
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && hasChildren(index)) {
      e.preventDefault();
      toggle(index, e.key === "ArrowRight");
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ x: r.left + 12, y: r.bottom, index });
    }
  };

  useEffect(() => {
    list.current?.querySelector(".outline-item.current")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // The rows get one set of handlers that never changes, so a row renders again only when its own heading does.
  const latest = useRef({ headings, onPointerDown, onItemKey, toggle });
  latest.current = { headings, onPointerDown, onItemKey, toggle };
  const rowActions = useMemo<RowActions>(
    () => ({
      activate: (i) => {
        if (suppressClick.current) suppressClick.current = false;
        else goToHeading(latest.current.headings[i], i);
      },
      pointerDown: (e, i) => latest.current.onPointerDown(e, i),
      keyDown: (e, i) => latest.current.onItemKey(e, i),
      contextMenu: (e, i) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, index: i });
      },
      toggle: (i) => latest.current.toggle(i),
    }),
    [],
  );

  // Built only when something a row shows changes; typing in a paragraph changes none of it.
  const rows = useMemo(
    () =>
      visible.map((i) => {
        const h = headings[i];
        return (
          <OutlineRow
            key={i}
            index={i}
            level={h.level}
            text={h.text}
            line={h.line}
            indent={12 + (h.level - minLevel) * 14}
            current={i === current}
            expandable={(headings[i + 1]?.level ?? 0) > h.level}
            closed={closed.has(slugs[i])}
            dragging={dragging?.from === i}
            dropBefore={!!dragging && dragging.drop === i && dragging.from !== i}
            actions={rowActions}
          />
        );
      }),
    [visible, headings, slugs, closed, current, dragging, minLevel, rowActions],
  );

  return (
    <section className={`sidebar-section outline${collapsed ? " collapsed" : ""}`} aria-label="Outline">
      <button
        className="sidebar-section-header"
        aria-expanded={!collapsed}
        onClick={() => update({ showOutline: collapsed })}
      >
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={14} />
        <span>Outline</span>
        {!collapsed && headings.length > 0 && <span className="badge">{headings.length}</span>}
      </button>
      {!collapsed && (
        content === undefined ? (
          <p className="sidebar-empty">No document is open.</p>
        ) : headings.length === 0 ? (
          <p className="sidebar-empty">No headings in this document.</p>
        ) : (
          <ul className={`outline-list${dragging?.drop === headings.length ? " drop-end" : ""}`} ref={list} role="list">
            {rows}
          </ul>
        )
      )}
      {menu && headings[menu.index] && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Actions for heading ${headings[menu.index].text}`}
          onClose={() => setMenu(null)}
          items={[
            { label: "Copy Link to Heading", run: () => copyText(`#${slugs[menu.index]}`, "Link") },
            {
              label: "Copy Markdown Link",
              run: () => copyText(`[${headings[menu.index].text.replace(/([[\]])/g, "\\$1")}](#${slugs[menu.index]})`, "Markdown link"),
            },
            { label: "Rename Heading…", run: () => void renameHeading(headings[menu.index].line), shortcut: "F2" },
            {
              label: "Select Section",
              run: () => {
                revealLine(headings[menu.index].line);
                runOnEditor(selectSection);
              },
            },
            "separator",
            { label: "Move Section Up", run: () => move(menu.index, -1), shortcut: "Alt+↑" },
            { label: "Move Section Down", run: () => move(menu.index, 1), shortcut: "Alt+↓" },
          ]}
        />
      )}
    </section>
  );
}
