import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { readFile } from "node:fs/promises";

const bookPath = process.argv[2];
if (!bookPath) {
  console.error("Usage: npm run verify:epub -- /path/to/book.epub");
  process.exit(2);
}

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
globalThis.window = {
  decodeURIComponent: globalThis.decodeURIComponent,
  URL: globalThis.URL,
  location: { href: "http://localhost/" },
};
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "Scroll Reader verifier" },
  configurable: true,
});

const epubModule = await import("epubjs");
const ePub = epubModule.default?.default ?? epubModule.default;
if (typeof ePub !== "function") throw new Error("Could not load EPUB.js.");
const bytes = await readFile(bookPath);
const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const book = ePub(input);
await book.opened;

const sections = [];
book.spine.each((section) => sections.push(section));
let renderedCharacters = 0;
let images = 0;
let internalAssetReferences = 0;

for (const section of sections) {
  const markup = await section.render(book.load.bind(book));
  renderedCharacters += markup.length;
  images += markup.match(/<img\b/gi)?.length ?? 0;
  internalAssetReferences += markup.match(/blob:/g)?.length ?? 0;
}

console.log(JSON.stringify({
  sections: sections.length,
  renderedCharacters,
  images,
  internalAssetReferences,
}));
book.destroy();
