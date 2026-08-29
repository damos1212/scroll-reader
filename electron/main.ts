import { app, BrowserWindow, dialog, ipcMain, protocol, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Entry, ZipFile } from "yauzl";

import { openZip } from "./archive-reader.js";
import { addToBudget, exceedsCompressionRatio, imageDimensions, imageMime, isNetworkUrl, naturalBookOrder, supportedBookArgument } from "./book-utils.js";

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_CBZ_PAGES = 2_000;
const MAX_PAGE_BYTES = 100 * 1024 * 1024;
const MAX_EPUB_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_EPUB_MARKUP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_EPUB_MARKUP_BYTES = 128 * 1024 * 1024;
const MAX_EPUB_SECTIONS = 2_000;
const MAX_COMPRESSION_RATIO = 100;
const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;
const MAX_IMAGE_PIXELS = 64_000_000;
const MAX_ARCHIVE_IMAGE_PIXELS = 256_000_000;
const MAX_BOOK_BYTES = 1024 * 1024 * 1024;
const MAX_BUFFERED_BOOK_BYTES = 512 * 1024 * 1024;
const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const SUPPORTED_BOOK = /\.(cbz|epub|pdf|txt)$/i;

interface PageMeta {
  name: string;
  mime: string;
  width: number;
  height: number;
}

interface BookManifest {
  bookId: string;
  resourceId: string;
  title: string;
  kind: "cbz" | "epub" | "pdf" | "txt";
  modifiedMs: number;
  pages: PageMeta[];
}

interface ActiveBook extends BookManifest {
  canonicalPath: string;
  handle: FileHandle;
  device: number;
  inode: number;
  size: number;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "scroll-reader-book",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

if (process.platform === "linux") app.commandLine.appendSwitch("ozone-platform-hint", "auto");

let mainWindow: BrowserWindow | null = null;
let activeBook: ActiveBook | null = null;
let activationGeneration = 0;
let startupPath = supportedBookArgument(process.argv.slice(1), process.cwd());

app.on("open-file", (event, bookPath) => {
  event.preventDefault();
  queueExternalBook(bookPath);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, workingDirectory) => {
    focusMainWindow();
    const bookPath = supportedBookArgument(argv, workingDirectory);
    if (bookPath) queueExternalBook(bookPath);
  });

  app.whenReady().then(() => {
    protocol.handle("scroll-reader-book", handleBookRequest);
    registerIpc();
    createWindow();
  });

  app.on("activate", () => {
    if (!mainWindow) createWindow();
    else focusMainWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function queueExternalBook(bookPath: string): void {
  if (!app.isReady() || !mainWindow || mainWindow.webContents.isLoadingMainFrame()) {
    startupPath = bookPath;
    return;
  }
  startupPath = null;
  void activateBook(bookPath).then((manifest) => {
    mainWindow?.webContents.send("reader:open-book", manifest);
  }, (error) => {
    dialog.showErrorBox("Could not open book", asError(error).message);
  });
}

function createWindow(): void {
  const preload = path.join(app.getAppPath(), "electron", "preload.cjs");
  mainWindow = new BrowserWindow({
    title: "Scroll Reader",
    width: 1100,
    height: 850,
    minWidth: 420,
    minHeight: 500,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  });
  const runtimeSession = mainWindow.webContents.session;
  runtimeSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    callback({ cancel: isNetworkUrl(details.url) });
  });
  runtimeSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("closed", () => {
    void closeActiveBook();
    mainWindow = null;
  });
  void mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
}

function registerIpc(): void {
  ipcMain.handle("reader:choose-book", async (event) => {
    assertTrustedIpc(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      filters: [{ name: "Books", extensions: ["cbz", "epub", "pdf", "txt"] }],
    });
    const selected = result.canceled ? null : result.filePaths[0] ?? null;
    return selected ? activateBook(selected) : null;
  });
  ipcMain.handle("reader:open-dropped-book", (event, bookPath: unknown) => {
    assertTrustedIpc(event);
    return activateBook(requirePath(bookPath));
  });
  ipcMain.handle("reader:read-text-book", (event, resourceId: unknown) => {
    assertTrustedIpc(event);
    return readTextBook(requireResourceId(resourceId));
  });
  ipcMain.handle("reader:close-book", (event, resourceId: unknown) => {
    assertTrustedIpc(event);
    return closeActiveBook(requireResourceId(resourceId));
  });
  ipcMain.handle("reader:startup-book", async (event) => {
    assertTrustedIpc(event);
    const value = startupPath;
    startupPath = null;
    return value ? activateBook(value) : null;
  });
  ipcMain.handle("reader:toggle-fullscreen", (event) => {
    assertTrustedIpc(event);
    if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  ipcMain.on("reader:refresh-rate", (event, rate: unknown) => {
    if (!isTrustedIpc(event)) return;
    if (typeof rate === "number" && Number.isFinite(rate)) {
      console.log(`Scroll Reader repaint cadence: approximately ${Math.round(rate)} Hz`);
    }
  });
  ipcMain.on("reader:book-opened", (event, kind: unknown, title: unknown) => {
    if (!isTrustedIpc(event)) return;
    if (typeof kind === "string" && typeof title === "string") console.log(`Opened ${kind.toUpperCase()}: ${title}`);
  });
  ipcMain.on("reader:renderer-error", (event, detail: unknown) => {
    if (!isTrustedIpc(event)) return;
    if (typeof detail === "string") console.error(`Reader error: ${detail}`);
  });
}

function isTrustedIpc(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame);
}

function assertTrustedIpc(event: IpcMainInvokeEvent): void {
  if (!isTrustedIpc(event)) throw new Error("Untrusted reader request.");
}

async function activateBook(bookPath: string): Promise<BookManifest> {
  const generation = ++activationGeneration;
  const inspected = await inspectBook(bookPath);
  if (generation !== activationGeneration) {
    await inspected.handle.close().catch(() => undefined);
    throw new Error("Book selection was superseded by a newer request.");
  }
  const previous = activeBook;
  activeBook = inspected;
  if (previous) await previous.handle.close().catch(() => undefined);
  return publicManifest(inspected);
}

async function closeActiveBook(expectedResourceId?: string): Promise<void> {
  if (!activeBook || (expectedResourceId && activeBook.resourceId !== expectedResourceId)) return;
  const closing = activeBook;
  activeBook = null;
  await closing.handle.close().catch(() => undefined);
}

function publicManifest(book: ActiveBook): BookManifest {
  const { bookId, resourceId, title, kind, modifiedMs, pages } = book;
  return { bookId, resourceId, title, kind, modifiedMs, pages };
}

async function inspectBook(bookPath: string): Promise<ActiveBook> {
  const canonical = await fs.realpath(bookPath);
  const handle = await fs.open(canonical, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("The selected path is not a regular file.");
    if (metadata.size > MAX_BOOK_BYTES) throw new Error("This book is larger than the 1 GiB safety limit.");
    const extension = path.extname(canonical).slice(1).toLowerCase();
    if (!SUPPORTED_BOOK.test(canonical)) throw new Error("Open a CBZ, EPUB, PDF, or TXT file.");
    const kind = extension as BookManifest["kind"];
    if ((kind === "epub" || kind === "pdf") && metadata.size > MAX_BUFFERED_BOOK_BYTES) {
      throw new Error(`${kind.toUpperCase()} exceeds the 512 MiB buffered-book safety limit.`);
    }
    const bookId = await hashFile(handle, metadata.size);
    const pages = kind === "cbz" ? await inspectCbz(handle, metadata.size) : kind === "epub" ? await inspectEpub(handle, metadata.size) : [];
    await validateHandleIdentity(handle, metadata.dev, metadata.ino, metadata.size, Math.round(metadata.mtimeMs));
    return {
      bookId,
      resourceId: randomUUID(),
      canonicalPath: canonical,
      handle,
      title: path.basename(canonical, path.extname(canonical)) || "Untitled",
      kind,
      modifiedMs: Math.round(metadata.mtimeMs),
      device: metadata.dev,
      inode: metadata.ino,
      size: metadata.size,
      pages,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function hashFile(handle: FileHandle, size: number): Promise<string> {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, size)));
  for (let position = 0; position < size;) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - position), position);
    if (!bytesRead) throw new Error("The selected book changed while it was being inspected.");
    hash.update(chunk.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function inspectCbz(handle: FileHandle, size: number): Promise<PageMeta[]> {
  const pages: PageMeta[] = [];
  let expandedBytes = 0;
  let decodedPixels = 0;
  await visitZip(handle, size, "CBZ", async (zipFile, entry) => {
    if (/\/$/.test(entry.fileName)) return;
    if (entry.uncompressedSize > MAX_PAGE_BYTES) throw new Error(`CBZ page '${entry.fileName}' exceeds 100 MiB.`);
    const mime = imageMime(entry.fileName);
    if (!mime) return;
    if (pages.length >= MAX_CBZ_PAGES) throw new Error(`CBZ contains more than ${MAX_CBZ_PAGES} image pages.`);
    const inspected = await inspectZipEntry(zipFile, entry, MAX_PAGE_BYTES, MAX_IMAGE_HEADER_BYTES);
    if (exceedsCompressionRatio(entry.compressedSize, inspected.size, MAX_COMPRESSION_RATIO)) {
      throw new Error(`CBZ page '${entry.fileName}' exceeds the compression-ratio safety limit.`);
    }
    const dimensions = imageDimensions(inspected.prefix);
    if (!dimensions) throw new Error(`CBZ page '${entry.fileName}' has unreadable image dimensions.`);
    if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new Error(`CBZ page '${entry.fileName}' exceeds the decoded-pixel safety limit.`);
    expandedBytes = addToBudget(expandedBytes, inspected.size, MAX_ARCHIVE_EXPANDED_BYTES, "CBZ expanded image data");
    decodedPixels = addToBudget(decodedPixels, dimensions.width * dimensions.height, MAX_ARCHIVE_IMAGE_PIXELS, "CBZ decoded image data");
    pages.push({ name: entry.fileName, mime, ...dimensions });
  });
  pages.sort((left, right) => naturalBookOrder(left.name, right.name));
  if (!pages.length) throw new Error("This CBZ does not contain supported images.");
  return pages;
}

async function inspectEpub(handle: FileHandle, size: number): Promise<PageMeta[]> {
  let expandedBytes = 0;
  let markupBytes = 0;
  let decodedPixels = 0;
  let spineItems = 0;
  await visitZip(handle, size, "EPUB", async (zipFile, entry) => {
    if (/\/$/.test(entry.fileName)) return;
    if (entry.uncompressedSize > MAX_EPUB_ENTRY_BYTES) {
      throw new Error(`EPUB entry '${entry.fileName}' exceeds 64 MiB.`);
    }
    const isMarkup = /\.(?:css|x?html?|xml|opf|ncx|svg)$/i.test(entry.fileName);
    if (isMarkup && entry.uncompressedSize > MAX_EPUB_MARKUP_ENTRY_BYTES) {
      throw new Error(`EPUB markup entry '${entry.fileName}' exceeds 8 MiB.`);
    }
    const isImage = /\.(?:gif|jpe?g|png|svg|webp)$/i.test(entry.fileName);
    const collectBytes = isMarkup ? MAX_EPUB_MARKUP_ENTRY_BYTES : isImage ? MAX_IMAGE_HEADER_BYTES : 0;
    const inspected = await inspectZipEntry(zipFile, entry, isMarkup ? MAX_EPUB_MARKUP_ENTRY_BYTES : MAX_EPUB_ENTRY_BYTES, collectBytes);
    if (exceedsCompressionRatio(entry.compressedSize, inspected.size, MAX_COMPRESSION_RATIO)) {
      throw new Error(`EPUB entry '${entry.fileName}' exceeds the compression-ratio safety limit.`);
    }
    expandedBytes = addToBudget(expandedBytes, inspected.size, MAX_ARCHIVE_EXPANDED_BYTES, "EPUB expanded data");
    if (isMarkup) {
      markupBytes = addToBudget(markupBytes, inspected.size, MAX_EPUB_MARKUP_BYTES, "EPUB markup data");
      if (/\.opf$/i.test(entry.fileName)) spineItems += countMatches(inspected.prefix, /<itemref\b/gi);
      if (spineItems > MAX_EPUB_SECTIONS) throw new Error(`EPUB contains more than ${MAX_EPUB_SECTIONS} spine sections.`);
    }
    if (isImage) {
      const dimensions = imageDimensions(inspected.prefix);
      if (!dimensions) throw new Error(`EPUB image '${entry.fileName}' has unreadable dimensions.`);
      if (dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw new Error(`EPUB image '${entry.fileName}' exceeds the decoded-pixel safety limit.`);
      decodedPixels = addToBudget(decodedPixels, dimensions.width * dimensions.height, MAX_ARCHIVE_IMAGE_PIXELS, "EPUB decoded image data");
    }
  });
  return [];
}

async function visitZip(handle: FileHandle, size: number, label: "CBZ" | "EPUB", visitor: (zipFile: ZipFile, entry: Entry) => void | Promise<void>): Promise<void> {
  const zipFile = await openZip(handle, size, label);
  return new Promise((resolve, reject) => {
    let count = 0;
    const fail = (error: Error): void => { zipFile.close(); reject(error); };
    zipFile.on("error", fail);
    zipFile.on("end", resolve);
    zipFile.on("entry", (entry) => {
      count += 1;
      if (count > MAX_ARCHIVE_ENTRIES) return fail(new Error(`${label} contains more than ${MAX_ARCHIVE_ENTRIES} entries.`));
      Promise.resolve(visitor(zipFile, entry)).then(() => zipFile.readEntry(), (error) => fail(asError(error)));
    });
    zipFile.readEntry();
  });
}

interface InspectedZipEntry {
  size: number;
  prefix: Uint8Array;
}

function inspectZipEntry(zipFile: ZipFile, entry: Entry, maximumBytes: number, prefixBytes: number): Promise<InspectedZipEntry> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error("Could not inspect archive entry."));
      const prefix: Buffer[] = [];
      let prefixSize = 0;
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximumBytes) return stream.destroy(new Error(`Archive entry '${entry.fileName}' exceeds its safety limit.`));
        if (prefixSize < prefixBytes) {
          const retained = chunk.subarray(0, Math.min(chunk.length, prefixBytes - prefixSize));
          prefix.push(Buffer.from(retained));
          prefixSize += retained.length;
        }
      });
      stream.on("error", reject);
      stream.on("end", () => resolve({ size, prefix: Buffer.concat(prefix) }));
    });
  });
}

function countMatches(bytes: Uint8Array, expression: RegExp): number {
  return [...new TextDecoder("utf-8", { fatal: false }).decode(bytes).matchAll(expression)].length;
}

async function handleBookRequest(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.hostname !== "localhost") throw new Error("Invalid book resource request.");
    const resourceId = requireResourceId(url.searchParams.get("id"));
    if (url.pathname === "/epub") {
      const book = requireActiveBook(resourceId, "epub");
      await validateActiveFile(book);
      const bytes = await readActiveBytes(book);
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Response(body, {
        headers: {
          "Content-Type": "application/epub+zip",
          "Cache-Control": "private, max-age=300",
          "Access-Control-Allow-Origin": "null",
        },
      });
    }
    if (url.pathname === "/pdf") {
      const book = requireActiveBook(resourceId, "pdf");
      await validateActiveFile(book);
      const bytes = await readActiveBytes(book);
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Response(body, {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "private, max-age=300",
          "Access-Control-Allow-Origin": "null",
        },
      });
    }
    if (url.pathname === "/cbz") {
      const book = requireActiveBook(resourceId, "cbz");
      await validateActiveFile(book);
      const entry = url.searchParams.get("entry");
      if (!entry || !imageMime(entry) || !book.pages.some((page) => page.name === entry)) {
        throw new Error("Unsupported CBZ page entry.");
      }
      const bytes = await readZipEntry(book.handle, book.size, entry);
      const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Response(body, {
        headers: {
          "Content-Type": imageMime(entry)!,
          "Cache-Control": "private, max-age=300",
          "Access-Control-Allow-Origin": "null",
        },
      });
    }
    throw new Error("Unknown book resource route.");
  } catch (error) {
    return new Response(asError(error).message, { status: 400, headers: { "Content-Type": "text/plain" } });
  }
}

async function readZipEntry(handle: FileHandle, size: number, requestedName: string): Promise<Uint8Array> {
  const zipFile = await openZip(handle, size, "CBZ");
  return new Promise((resolve, reject) => {
    let settled = false;
    let count = 0;
    const fail = (error: Error): void => { if (!settled) { settled = true; zipFile.close(); reject(error); } };
    zipFile.on("error", fail);
    zipFile.on("end", () => fail(new Error("The requested page is missing from the CBZ.")));
    zipFile.on("entry", (entry) => {
      count += 1;
      if (count > MAX_ARCHIVE_ENTRIES) return fail(new Error(`CBZ contains more than ${MAX_ARCHIVE_ENTRIES} entries.`));
      if (entry.fileName !== requestedName) return zipFile.readEntry();
      if (entry.uncompressedSize > MAX_PAGE_BYTES) return fail(new Error("CBZ page exceeds the 100 MiB safety limit."));
      collectEntry(zipFile, entry).then((bytes) => {
        if (!settled) { settled = true; resolve(bytes); zipFile.close(); }
      }, fail);
    });
    zipFile.readEntry();
  });
}

function collectEntry(zipFile: ZipFile, entry: Entry): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error("Could not read CBZ page."));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_PAGE_BYTES) stream.destroy(new Error("CBZ page exceeds the 100 MiB safety limit."));
        else chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function readTextBook(resourceId: string): Promise<string> {
  const book = requireActiveBook(resourceId, "txt");
  await validateActiveFile(book);
  if (book.size > MAX_TEXT_BYTES) throw new Error("TXT book exceeds the 64 MiB safety limit.");
  return (await readActiveBytes(book)).toString("utf8");
}

function requireActiveBook(resourceId: string, kind: BookManifest["kind"]): ActiveBook {
  if (!activeBook || activeBook.resourceId !== resourceId || activeBook.kind !== kind) {
    throw new Error("This book resource is no longer authorized.");
  }
  return activeBook;
}

async function validateActiveFile(book: ActiveBook): Promise<void> {
  await validateHandleIdentity(book.handle, book.device, book.inode, book.size, book.modifiedMs);
}

async function validateHandleIdentity(handle: FileHandle, device: number, inode: number, size: number, modifiedMs: number): Promise<void> {
  const metadata = await handle.stat();
  if (!metadata.isFile() || metadata.dev !== device || metadata.ino !== inode || metadata.size !== size || Math.round(metadata.mtimeMs) !== modifiedMs) {
    throw new Error("The selected book changed after it was opened.");
  }
}

async function readActiveBytes(book: ActiveBook): Promise<Buffer> {
  await validateActiveFile(book);
  const bytes = Buffer.allocUnsafe(book.size);
  for (let position = 0; position < bytes.length;) {
    const { bytesRead } = await book.handle.read(bytes, position, bytes.length - position, position);
    if (!bytesRead) throw new Error("The selected book changed while it was being read.");
    position += bytesRead;
  }
  await validateActiveFile(book);
  return bytes;
}

function requirePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("No book path was provided.");
  return value;
}

function requireResourceId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid book resource identifier.");
  return value;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
