import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { countSentences, countWords, readingEase, textStats } from "../src/services/textStats";
import { StatusBar } from "../src/components/StatusBar";
import { newDocument } from "../src/features/documents";
import { setupBackend } from "./helpers";

describe("text statistics", () => {
  it("counts words, characters, lines, paragraphs and reading time", () => {
    const s = textStats("Hello world.\nSecond line 🚀\n\nNew paragraph here");
    expect(s).toEqual({
      words: 7,
      characters: 46,
      charactersNoSpaces: 38,
      lines: 4,
      paragraphs: 2,
      readingMinutes: 1,
      sentences: 3,
      speakingMinutes: 1,
      readingEase: null,
    });
    expect(textStats("")).toMatchObject({ words: 0, lines: 0, paragraphs: 0, readingMinutes: 0 });
    expect(textStats("word ".repeat(1150)).readingMinutes).toBe(5);
    expect(textStats("word ".repeat(1300)).speakingMinutes).toBe(10);
  });

  it("counts words like the word pattern, in every script", () => {
    const pattern = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
    const samples = [
      "",
      "don't stop-gap snake_case it’s",
      "'quoted' -dash _under 'tis",
      "café naïve über straße добрый день",
      "日本語 中文 한국어",
      "math \u{1D400}\u{1D401} and \u{1F680} rocket\u{1F680}ship",
      "lone \ud800 surrogate b\ud800a x\udc00y",
      "3.14 1,000 v2-beta a--b a-'b _ - ' 42",
      "# Title\n\n- [ ] task one\n- [x] `code` **bold**\n\n| a | b |\n",
    ];
    // Pieces in every order, so words meet every kind of neighbour.
    const pieces = ["a", "Z", "9", "'", "’", "_", "-", " ", "\n", ".", "é", "日", "\u{1F680}", "\u{1D400}", "\ud800"];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let n = 0; n < 300; n++) {
      let text = "";
      for (let k = 0; k < 40; k++) text += pieces[next() % pieces.length];
      samples.push(text);
    }
    for (const text of samples) expect(countWords(text), JSON.stringify(text)).toBe(text.match(pattern)?.length ?? 0);
  });

  it("counts sentences, headings and list items", () => {
    expect(countSentences("# Title\n\n- one item\n- two item\n\nA sentence. Another one! \"Quoted?\" End")).toBe(7);
    expect(countSentences("Version 1.2 is out. See the notes")).toBe(2);
    expect(countSentences("A line\nwrapped by hand.")).toBe(1);
    expect(countSentences("")).toBe(0);
  });

  it("scores English readability from 0 (hard) to 100 (easy)", () => {
    const easy = "The cat sat on the mat. It was a big cat. The dog ran to the cat. They were friends. The sun was hot. We had fun all day long.";
    const hard =
      "Notwithstanding considerable methodological heterogeneity, contemporary epidemiological investigations consistently demonstrate substantial associations between socioeconomic deprivation and cardiovascular morbidity, particularly among populations experiencing intergenerational disadvantage and institutional marginalization.";
    expect(readingEase(easy)).toBeGreaterThanOrEqual(90);
    expect(readingEase(`${hard} ${hard}`)).toBeLessThanOrEqual(10);
    expect(readingEase("Too short to score.")).toBeNull();
    expect(readingEase("これは日本語の文章です。".repeat(40))).toBeNull();
  });
});

describe("status bar statistics", () => {
  it("opens a document statistics popover from the word count", async () => {
    setupBackend();
    render(<StatusBar />);
    act(() => {
      newDocument("one two three");
    });
    await userEvent.click(screen.getByRole("button", { name: "3 words" }));
    const dialog = screen.getByRole("dialog", { name: "Document statistics" });
    expect(dialog).toHaveTextContent("Characters13");
    expect(dialog).toHaveTextContent("Reading time1 min");
    expect(dialog).toHaveTextContent("Sentences1");
    expect(dialog).toHaveTextContent("Readability—");
  });
});
