import { describe, expect, it } from "vitest";

import path from "node:path";

import { addToBudget, exceedsCompressionRatio, imageDimensions, imageMime, isNetworkUrl, naturalBookOrder, supportedBookArgument } from "./book-utils";

describe("book utilities", () => {
  it("sorts numbered manga pages naturally", () => {
    expect(["10.jpg", "2.jpg", "1.jpg"].sort(naturalBookOrder)).toEqual(["1.jpg", "2.jpg", "10.jpg"]);
  });

  it("recognizes supported image types case-insensitively", () => {
    expect(imageMime("folder/PAGE.JPEG")).toBe("image/jpeg");
    expect(imageMime("page.WEBP")).toBe("image/webp");
    expect(imageMime("untrusted.avif")).toBeNull();
    expect(imageMime("page.bmp")).toBeNull();
  });

  it("identifies network protocols without treating local book resources as network", () => {
    expect(isNetworkUrl("https://example.com/beacon")).toBe(true);
    expect(isNetworkUrl("ws://127.0.0.1/socket")).toBe(true);
    expect(isNetworkUrl("scroll-reader-book://localhost/cbz?id=abc")).toBe(false);
    expect(isNetworkUrl("file:///tmp/index.html")).toBe(false);
    expect(isNetworkUrl("not a URL")).toBe(true);
  });

  it("finds file-association arguments and resolves relative book paths", () => {
    expect(supportedBookArgument(["--original-process-start-time=42", "books/story.EPUB"], "/reader"))
      .toBe(path.resolve("/reader", "books/story.EPUB"));
    expect(supportedBookArgument(["--inspect=book.pdf", "notes.md"], "/reader")).toBeNull();
  });

  it("enforces aggregate byte budgets and compression ratios", () => {
    expect(addToBudget(40, 2, 42, "Archive")).toBe(42);
    expect(() => addToBudget(42, 1, 42, "Archive")).toThrow("Archive exceeds");
    expect(() => addToBudget(Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER, "Archive")).toThrow();
    expect(exceedsCompressionRatio(10, 1000, 100)).toBe(false);
    expect(exceedsCompressionRatio(10, 1001, 100)).toBe(true);
    expect(exceedsCompressionRatio(0, 1, 100)).toBe(true);
  });

  it("reads common raster and vector image dimensions from headers", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 1800);
    expect(imageDimensions(png)).toEqual({ width: 1200, height: 1800 });

    expect(imageDimensions(new TextEncoder().encode('<svg viewBox="0 0 800 600"></svg>'))).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(new TextEncoder().encode("....ispe....fake dimensions"))).toBeNull();
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
