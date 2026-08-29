const MAX_OUTPUT_SCALE = 2;
const MAX_CANVAS_DIMENSION = 8_192;
const MAX_CANVAS_PIXELS = 32_000_000;
const MAX_PAGE_ASPECT_RATIO = 100;

export interface PdfRenderMetrics {
  viewportScale: number;
  outputScale: number;
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

export function pdfRenderMetrics(
  pageWidth: number,
  pageHeight: number,
  availableWidth: number,
  deviceScale: number,
): PdfRenderMetrics {
  if (![pageWidth, pageHeight, availableWidth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError("PDF page and viewport dimensions must be positive finite numbers.");
  }
  const outputScale = Number.isFinite(deviceScale)
    ? Math.min(MAX_OUTPUT_SCALE, Math.max(1, deviceScale))
    : 1;
  const cssWidth = availableWidth;
  const viewportScale = cssWidth / pageWidth;
  const cssHeight = pageHeight * viewportScale;
  const pixelWidth = Math.ceil(cssWidth * outputScale);
  const pixelHeight = Math.ceil(cssHeight * outputScale);
  const aspectRatio = Math.max(pageWidth / pageHeight, pageHeight / pageWidth);
  if (!Number.isFinite(cssHeight) || aspectRatio > MAX_PAGE_ASPECT_RATIO) {
    throw new RangeError("PDF page aspect ratio exceeds the safety limit.");
  }
  if (pixelWidth > MAX_CANVAS_DIMENSION || pixelHeight > MAX_CANVAS_DIMENSION || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS) {
    throw new RangeError("PDF page canvas exceeds the pixel safety limit.");
  }
  return {
    viewportScale,
    outputScale,
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
  };
}

export function addPixelBudget(current: number, width: number, height: number, maximum: number, label: string): number {
  if (![current, width, height, maximum].every(Number.isSafeInteger) || current < 0 || width <= 0 || height <= 0 || maximum < 1) {
    throw new RangeError(`${label} contains invalid pixel dimensions.`);
  }
  const pixels = width * height;
  const total = current + pixels;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(total) || total > maximum) {
    throw new RangeError(`${label} exceeds the pixel safety limit.`);
  }
  return total;
}
