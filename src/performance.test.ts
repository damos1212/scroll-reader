import { describe, expect, it } from "vitest";

import { estimateRefreshRate } from "./performance";

function frames(interval: number, count = 20): number[] {
  return Array.from({ length: count }, (_, index) => index * interval);
}

describe("refresh-rate diagnostics", () => {
  it("recognizes a 60 Hz repaint cadence", () => {
    expect(estimateRefreshRate(frames(1000 / 60))).toBe(60);
  });

  it("recognizes a 144 Hz repaint cadence", () => {
    expect(estimateRefreshRate(frames(1000 / 144))).toBe(144);
  });

  it("ignores a single scheduling outlier", () => {
    const timestamps = frames(1000 / 120);
    timestamps[10] += 18;
    expect(estimateRefreshRate(timestamps)).toBe(120);
  });
});
