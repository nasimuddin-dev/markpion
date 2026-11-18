import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CustomDocumentCss } from "../src/components/CustomDocumentCss";
import { commands } from "../src/features/commands";
import { scopeCustomCss } from "../src/services/customCss";
import { DOCUMENT_STYLES, documentCss, isDocumentStyle, type DocumentStyle } from "../src/services/documentStyles";
import { useSettings } from "../src/stores/settingsStore";

const styles = Object.keys(DOCUMENT_STYLES) as DocumentStyle[];

describe("document styles", () => {
  it("are valid CSS that styles only the document, and no colours (the theme's stay)", () => {
    for (const style of styles) {
      const css = DOCUMENT_STYLES[style].css;
      const scoped = scopeCustomCss(css);
      // Every rule survives scoping: the same number of rules, each inside the document.
      const rules = scoped.split("\n").filter((l) => l.trim());
      expect(rules.length, style).toBe((css.match(/\{/g) ?? []).length);
      for (const rule of rules) expect(rule, style).toMatch(/^\.markdown-body/);
      expect(css, style).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|\b(?:black|white|red|blue|gr[ae]y)\b/i);
    }
    expect(DOCUMENT_STYLES.default.css).toBe("");
  });

  it("come before the user's own CSS, which can adjust them", () => {
    expect(documentCss({ documentStyle: "default", customCss: "" })).toBe("");
    expect(documentCss({ documentStyle: "default", customCss: "h1 { color: red; }" })).toBe("h1 { color: red; }");
    const both = documentCss({ documentStyle: "book", customCss: "p { text-align: left; }" });
    expect(both.indexOf("text-align: justify")).toBeGreaterThan(-1);
    expect(both.indexOf("text-align: left")).toBeGreaterThan(both.indexOf("text-align: justify"));
    expect(isDocumentStyle("report")).toBe(true);
    expect(isDocumentStyle("toString")).toBe(false);
    expect(isDocumentStyle(3)).toBe(false);
  });

  it("are chosen from View → Document Style and applied to rendered documents", () => {
    useSettings.getState().update({ documentStyle: "default", customCss: "" });
    const { container, rerender } = render(<CustomDocumentCss />);
    expect(container.querySelector("style")).toBeNull();

    commands.documentStyleBook.run();
    rerender(<CustomDocumentCss />);
    expect(useSettings.getState().settings.documentStyle).toBe("book");
    expect(commands.documentStyleBook.checked?.()).toBe(true);
    expect(commands.documentStyleDefault.checked?.()).toBe(false);
    expect(container.querySelector("style")?.textContent).toContain(".markdown-body p { text-align: justify;");

    commands.documentStyleDefault.run();
    rerender(<CustomDocumentCss />);
    expect(container.querySelector("style")).toBeNull();
    // One command per style.
    expect(styles.map((s) => `documentStyle${s[0].toUpperCase()}${s.slice(1)}`).filter((id) => !commands[id])).toEqual([]);
  });

  it("keeps a saved style, and falls back to the default for an unknown one", async () => {
    const { sanitizeSettings } = await import("../src/stores/settingsStore");
    expect(sanitizeSettings({ documentStyle: "compact" }).documentStyle).toBe("compact");
    expect(sanitizeSettings({ documentStyle: "fancy" }).documentStyle).toBe("default");
  });
});
