import { describe, expect, it } from "vitest";

import {
  bookStateKey,
  clampFontSize,
  clampZoomFactor,
  epubSectionFromCfi,
  loadBookState,
  loadPreferences,
  nextTextWidth,
  saveBookState,
  scrollRatio,
  zoomedScrollOffset,
} from "./state";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("reader state", () => {
  it("clamps font sizes to readable limits", () => {
    expect(clampFontSize(4)).toBe(14);
    expect(clampFontSize(23.6)).toBe(24);
    expect(clampFontSize(100)).toBe(40);
  });

  it("clamps zoom to 10 percent steps between 50 and 300 percent", () => {
    expect(clampZoomFactor(0.2)).toBe(0.5);
    expect(clampZoomFactor(1.26)).toBe(1.3);
    expect(clampZoomFactor(4)).toBe(3);
    expect(clampZoomFactor(Number.NaN)).toBe(1);
  });

  it("keeps the pointer anchor stable while zooming", () => {
    expect(zoomedScrollOffset(100, 50, 1, 2)).toBe(250);
    expect(zoomedScrollOffset(250, 50, 2, 1)).toBe(100);
    expect(zoomedScrollOffset(100, 50, 0, 2)).toBe(100);
  });

  it("cycles the supported text widths", () => {
    expect(nextTextWidth(null)).toBe(760);
    expect(nextTextWidth(760)).toBe(860);
    expect(nextTextWidth(860)).toBe(680);
    expect(nextTextWidth(680)).toBeNull();
  });

  it("uses the standard text settings when no preferences are saved", () => {
    expect(loadPreferences(new MemoryStorage())).toEqual({ fontSize: 22, textWidth: 760, pdfDark: false, zoomFactor: 1 });
  });

  it("falls back when preferences are malformed", () => {
    const storage = new MemoryStorage();
    storage.setItem("scroll-reader:preferences:v2", "not-json");
    expect(loadPreferences(storage)).toEqual({ fontSize: 22, textWidth: 760, pdfDark: false, zoomFactor: 1 });
  });

  it("loads a persisted PDF color preference", () => {
    const storage = new MemoryStorage();
    storage.setItem("scroll-reader:preferences:v2", JSON.stringify({ fontSize: null, textWidth: null, pdfDark: true }));
    expect(loadPreferences(storage).pdfDark).toBe(true);
  });

  it("loads persisted zoom and defaults legacy preferences to 100 percent", () => {
    const storage = new MemoryStorage();
    storage.setItem("scroll-reader:preferences:v2", JSON.stringify({ zoomFactor: 1.6 }));
    expect(loadPreferences(storage).zoomFactor).toBe(1.6);
    storage.setItem("scroll-reader:preferences:v2", JSON.stringify({ fontSize: 22 }));
    expect(loadPreferences(storage).zoomFactor).toBe(1);
  });

  it("keys saved positions by content hash, independent of file path", () => {
    expect(bookStateKey({ bookId: "same-hash" })).toBe(bookStateKey({ bookId: "same-hash" }));
    expect(bookStateKey({ bookId: "same-hash" })).toBe("scroll-reader:book:v2:same-hash");
  });

  it("round-trips a saved CBZ position", () => {
    const storage = new MemoryStorage();
    const book = { bookId: "abc123" };
    saveBookState(book, { cbzPage: 12, cbzOffset: 0.4 }, storage);
    expect(loadBookState(book, storage)).toMatchObject({ version: 1, cbzPage: 12, cbzOffset: 0.4 });
  });

  it("round-trips a saved PDF page and within-page offset", () => {
    const storage = new MemoryStorage();
    const book = { bookId: "pdf123" };
    saveBookState(book, { pdfPage: 18, pdfOffset: 0.65 }, storage);
    expect(loadBookState(book, storage)).toMatchObject({ version: 1, pdfPage: 18, pdfOffset: 0.65 });
  });

  it("does not expose filesystem paths to migrate legacy position keys", () => {
    const storage = new MemoryStorage();
    const book = { bookId: "abc123" };
    storage.setItem("scroll-reader:book:v1:/books/a.cbz:42", JSON.stringify({ version: 1, cbzPage: 7 }));
    expect(loadBookState(book, storage)).toBeNull();
  });

  it("calculates bounded scroll progress", () => {
    expect(scrollRatio(250, 1000, 500)).toBe(0.5);
    expect(scrollRatio(-20, 1000, 500)).toBe(0);
    expect(scrollRatio(900, 1000, 500)).toBe(1);
    expect(scrollRatio(0, 500, 500)).toBe(0);
  });

  it("maps a legacy EPUB CFI to its spine section", () => {
    expect(epubSectionFromCfi("epubcfi(/6/34[id]!/4/2)")).toBe(16);
    expect(epubSectionFromCfi(undefined)).toBeNull();
    expect(epubSectionFromCfi("not-a-cfi")).toBeNull();
  });
});
