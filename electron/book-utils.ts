import path from "node:path";

const NETWORK_PROTOCOLS = new Set(["ftp:", "http:", "https:", "ws:", "wss:"]);
const SUPPORTED_BOOK = /\.(cbz|epub|pdf|txt)$/i;

export function supportedBookArgument(argv: string[], workingDirectory: string): string | null {
  const argument = argv.find((value) => !value.startsWith("-") && SUPPORTED_BOOK.test(value));
  return argument ? path.resolve(workingDirectory, argument) : null;
}

export function imageMime(name: string): string | null {
  switch (path.extname(name).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return null;
  }
}

export function naturalBookOrder(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function isNetworkUrl(value: string): boolean {
  try {
    return NETWORK_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return true;
  }
}

export function addToBudget(current: number, amount: number, maximum: number, label: string): number {
  if (![current, amount, maximum].every(Number.isSafeInteger) || current < 0 || amount < 0 || maximum < 0) {
    throw new RangeError(`${label} contains an invalid size.`);
  }
  const total = current + amount;
  if (!Number.isSafeInteger(total) || total > maximum) throw new RangeError(`${label} exceeds its safety limit.`);
  return total;
}

export function exceedsCompressionRatio(compressedBytes: number, expandedBytes: number, maximumRatio: number): boolean {
  if (![compressedBytes, expandedBytes, maximumRatio].every(Number.isSafeInteger)) return true;
  if (compressedBytes < 0 || expandedBytes < 0 || maximumRatio < 1) return true;
  return expandedBytes > 0 && (compressedBytes === 0 || expandedBytes / compressedBytes > maximumRatio);
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export function imageDimensions(bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    return validDimensions(view.getUint32(16), view.getUint32(20));
  }
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === "GIF") {
    return validDimensions(view.getUint16(6, true), view.getUint16(8, true));
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X") return validDimensions(1 + uint24Le(bytes, 24), 1 + uint24Le(bytes, 27));
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      return validDimensions(1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)));
    }
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return validDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (offset + 4 > bytes.length) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return validDimensions(view.getUint16(offset + 7), view.getUint16(offset + 5));
      }
      offset += 2 + length;
    }
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const svg = text.match(/<svg\b[^>]*>/i)?.[0];
  if (svg) {
    const width = numericSvgAttribute(svg, "width");
    const height = numericSvgAttribute(svg, "height");
    if (width && height) return validDimensions(width, height);
    const viewBox = svg.match(/\bviewBox\s*=\s*["']\s*[-+\d.e]+[\s,]+[-+\d.e]+[\s,]+([-+\d.e]+)[\s,]+([-+\d.e]+)\s*["']/i);
    if (viewBox) return validDimensions(Number(viewBox[1]), Number(viewBox[2]));
  }
  return null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function numericSvgAttribute(svg: string, name: string): number | null {
  const value = svg.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([-+\\d.e]+)`, "i"))?.[1];
  return value ? Number(value) : null;
}

function validDimensions(width: number, height: number): ImageDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const roundedWidth = Math.ceil(width);
  const roundedHeight = Math.ceil(height);
  return Number.isSafeInteger(roundedWidth) && Number.isSafeInteger(roundedHeight) ? { width: roundedWidth, height: roundedHeight } : null;
}
