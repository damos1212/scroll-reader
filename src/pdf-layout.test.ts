import { describe, expect, it } from "vitest";

import { addPixelBudget, pdfRenderMetrics } from "./pdf-layout";

describe("PDF page layout", () => {
  it("fits a portrait page to the available reader width", () => {
    expect(pdfRenderMetrics(600, 900, 1200, 1)).toEqual({
      viewportScale: 2,
      outputScale: 1,
      cssWidth: 1200,
      cssHeight: 1800,
      pixelWidth: 1200,
      pixelHeight: 1800,
    });
  });

  it("renders sharply while capping excessive display scaling", () => {
    const metrics = pdfRenderMetrics(800, 600, 1000, 3);
    expect(metrics.outputScale).toBe(2);
    expect(metrics.pixelWidth).toBe(2000);
    expect(metrics.pixelHeight).toBe(1500);
  });

  it("rejects invalid page dimensions", () => {
    expect(() => pdfRenderMetrics(0, 900, 1000, 1)).toThrow(RangeError);
  });

  it("rejects extreme page geometry and oversized canvases", () => {
    expect(() => pdfRenderMetrics(1, 1000, 1000, 2)).toThrow("aspect ratio");
    expect(() => pdfRenderMetrics(1000, 4000, 1600, 2)).toThrow("pixel safety");
  });

  it("enforces an aggregate decoded-pixel budget", () => {
    expect(addPixelBudget(10, 5, 6, 40, "Book")).toBe(40);
    expect(() => addPixelBudget(10, 5, 7, 40, "Book")).toThrow("pixel safety");
    expect(() => addPixelBudget(0, Number.MAX_SAFE_INTEGER, 2, Number.MAX_SAFE_INTEGER, "Book")).toThrow();
  });
});
