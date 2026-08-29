export function estimateRefreshRate(timestamps: readonly number[]): number | null {
  if (timestamps.length < 3) return null;
  const deltas = timestamps
    .slice(1)
    .map((time, index) => time - timestamps[index])
    .filter((delta) => delta >= 2 && delta <= 100)
    .sort((left, right) => left - right);
  if (deltas.length < 2) return null;
  const middle = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 0 ? (deltas[middle - 1] + deltas[middle]) / 2 : deltas[middle];
  return Math.round(1000 / median);
}

export function measureRefreshRate(frameCount = 90): Promise<number | null> {
  return new Promise((resolve) => {
    const timestamps: number[] = [];
    const sample = (timestamp: number): void => {
      timestamps.push(timestamp);
      if (timestamps.length >= frameCount) resolve(estimateRefreshRate(timestamps));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}
