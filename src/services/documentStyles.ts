/**
 * Ready-made looks for rendered documents (View → Document Style): a starting
 * point that needs no CSS. Each is ordinary document CSS, applied before the
 * user's custom CSS (which can adjust it) and scoped the same way, so it
 * styles the preview, printing, slides and HTML/EPUB export, and nothing of
 * the app around the document. They set type and spacing only; colours stay
 * the theme's, so every style works in light and dark.
 */

export type DocumentStyle = "default" | "book" | "report" | "compact";

export const DOCUMENT_STYLES: Record<DocumentStyle, { label: string; description: string; css: string }> = {
  default: { label: "Default", description: "Clean sans-serif, like GitHub", css: "" },
  book: {
    label: "Book",
    description: "Serif type, a centred title and justified paragraphs, for long reading",
    css: `
body { font-family: Georgia, "Iowan Old Style", "Palatino Linotype", "Times New Roman", serif; font-size: 1.06em; line-height: 1.75; }
h1, h2, h3, h4, h5, h6 { font-family: inherit; font-weight: 600; border-bottom: none; }
h1 { text-align: center; font-size: 2.1em; margin-bottom: 1.2em; }
h2 { margin-top: 2em; }
p { text-align: justify; hyphens: auto; }
blockquote { font-style: italic; }
`,
  },
  report: {
    label: "Report",
    description: "Strong headings with a rule, and full-width tables, for documents you hand over",
    css: `
body { line-height: 1.6; }
h1 { font-size: 2.2em; font-weight: 800; letter-spacing: -0.01em; border-bottom: 3px solid currentColor; padding-bottom: 0.25em; }
h2 { margin-top: 1.8em; font-weight: 700; border-bottom: 1px solid currentColor; padding-bottom: 0.2em; }
h3 { text-transform: uppercase; font-size: 0.95em; letter-spacing: 0.06em; }
table { width: 100%; }
th { text-align: left; text-transform: uppercase; font-size: 0.85em; letter-spacing: 0.04em; }
`,
  },
  compact: {
    label: "Compact",
    description: "Smaller type and tighter spacing, to see more of a page of notes",
    css: `
body { font-size: 0.9em; line-height: 1.45; }
p, ul, ol, blockquote, pre, table, details { margin-bottom: 0.6em; }
h1, h2, h3, h4, h5, h6 { margin-top: 0.9em; margin-bottom: 0.35em; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.3em; }
li { margin-top: 0.1em; margin-bottom: 0.1em; }
`,
  },
};

export const isDocumentStyle = (value: unknown): value is DocumentStyle => typeof value === "string" && Object.hasOwn(DOCUMENT_STYLES, value);

/** The document's CSS before scoping: the chosen style's, then the user's own. */
export function documentCss(settings: { documentStyle: DocumentStyle; customCss: string }): string {
  const style = DOCUMENT_STYLES[settings.documentStyle]?.css ?? "";
  return style && settings.customCss ? `${style}\n${settings.customCss}` : style || settings.customCss;
}
