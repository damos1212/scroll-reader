import { describe, expect, it } from "vitest";

import { epubDocumentCss, securedEpubMarkup } from "./epub-style";

describe("EPUB document styling", () => {
  it("preserves publisher typography and width in book-style mode", () => {
    const css = epubDocumentCss({ fontSize: null, textWidth: null, pdfDark: false, zoomFactor: 1 });
    expect(css).not.toContain("font-family");
    expect(css).not.toMatch(/body\{[^}]*font-size:/);
    expect(css).not.toMatch(/body\{[^}]*max-width:/);
  });

  it("adds only the requested font-size override", () => {
    const css = epubDocumentCss({ fontSize: 22, textWidth: null, pdfDark: false, zoomFactor: 1 });
    expect(css).toContain("font-size:22px !important");
    expect(css).not.toContain("font-family");
    expect(css).not.toMatch(/body\{[^}]*max-width:/);
  });

  it("adds the selected readable-width override", () => {
    const css = epubDocumentCss({ fontSize: null, textWidth: 760, pdfDark: false, zoomFactor: 1 });
    expect(css).toContain("max-width:760px !important");
    expect(css).toContain("margin-left:auto !important");
  });

  it("blocks inline data images before EPUB markup is rendered", () => {
    const markup = securedEpubMarkup('<img src="data:image/png;base64,AAAA">');
    expect(markup).toContain("default-src 'none'");
    expect(markup).toContain("img-src scroll-reader-book: blob:");
    expect(markup).not.toContain("img-src scroll-reader-book: blob: data:");
    expect(markup.indexOf("Content-Security-Policy")).toBeLessThan(markup.indexOf("<img"));
  });
});
