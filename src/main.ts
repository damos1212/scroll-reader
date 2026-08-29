import "./style.css";

import ePub from "epubjs";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

import { epubDocumentCss, securedEpubMarkup } from "./epub-style";
import { addPixelBudget, pdfRenderMetrics } from "./pdf-layout";
import { measureRefreshRate } from "./performance";
import {
  clampFontSize,
  epubSectionFromCfi,
  loadBookState,
  loadPreferences,
  nextTextWidth,
  saveBookState,
  savePreferences,
  scrollRatio,
} from "./state";
import type { BookManifest, ReaderPreferences, StoredBookState } from "./types";

const STANDARD_FONT_SIZE = 22;
const STANDARD_TEXT_WIDTH = 760;
const TOOLBAR_REVEAL_HEIGHT = 80;
const MAX_CBZ_PAGE_PIXELS = 64_000_000;
const MAX_RETAINED_IMAGE_PIXELS = 256_000_000;
const MAX_EPUB_SECTIONS = 2_000;
const MAX_EPUB_SECTION_MARKUP_BYTES = 8 * 1024 * 1024;
const MAX_EPUB_TOTAL_MARKUP_BYTES = 128 * 1024 * 1024;
const MAX_PDF_PAGES = 2_000;
const MAX_PDF_RETAINED_PIXELS = 256_000_000;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const toolbar = requiredElement<HTMLElement>("toolbar");
const toolbarRevealZone = requiredElement<HTMLElement>("toolbar-reveal-zone");
const welcome = requiredElement<HTMLElement>("welcome");
const reader = requiredElement<HTMLElement>("reader");
const message = requiredElement<HTMLElement>("message");
const titleLabel = requiredElement<HTMLElement>("book-title");
const progressLabel = requiredElement<HTMLElement>("progress");
const fontLabel = requiredElement<HTMLButtonElement>("font-label");
const widthButton = requiredElement<HTMLButtonElement>("width-toggle");
const pdfColorsButton = requiredElement<HTMLButtonElement>("pdf-colors");

let preferences: ReaderPreferences = loadPreferences();
let currentBook: BookManifest | null = null;
let epubBook: ReturnType<typeof ePub> | null = null;
let pdfDocument: PDFDocumentProxy | null = null;
let pdfLoadingTask: PDFDocumentLoadingTask | null = null;
let scrollFrame: number | undefined;
let saveTimer: number | undefined;
let toolbarTimer: number | undefined;
let messageTimer: number | undefined;
let openGeneration = 0;

applyPreferences();
bindControls();
void bindWindowEvents();
window.readerApi.onOpenBook((manifest) => void openExternalBook(manifest));
showToolbar();
void openStartupBook();
void reportRefreshRate();

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function bindControls(): void {
  requiredElement("open-book").addEventListener("click", () => void chooseBook());
  requiredElement("welcome-open").addEventListener("click", () => void chooseBook());
  requiredElement("font-down").addEventListener("click", () => changeFontSize(-2));
  requiredElement("font-up").addEventListener("click", () => changeFontSize(2));
  fontLabel.addEventListener("click", resetBookFont);
  widthButton.addEventListener("click", cycleTextWidth);
  pdfColorsButton.addEventListener("click", togglePdfColors);
  requiredElement("fullscreen").addEventListener("click", () => void toggleFullscreen());

  window.addEventListener("scroll", handleWindowScroll, { passive: true });
  window.addEventListener("resize", handleWindowResize, { passive: true });
  window.addEventListener("pointermove", handlePointerMove, { passive: true });
  toolbar.addEventListener("pointerenter", () => window.clearTimeout(toolbarTimer));
  toolbar.addEventListener("pointerleave", scheduleToolbarHide);
  toolbarRevealZone.addEventListener("pointerenter", showToolbar);
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("beforeunload", saveCurrentPosition);
}

async function bindWindowEvents(): Promise<void> {
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    showToolbar();
    const file = event.dataTransfer?.files[0];
    if (file) void openDroppedBook(file);
  });
}

async function openDroppedBook(file: File): Promise<void> {
  const operation = ++openGeneration;
  setLoading(true);
  try {
    const manifest = await window.readerApi.openDroppedBook(file);
    if (operation !== openGeneration) return void window.readerApi.closeBook(manifest.resourceId);
    await openBook(manifest, operation);
  } catch (error) {
    if (operation === openGeneration) handleOpenError(error);
  } finally {
    if (operation === openGeneration) setLoading(false);
  }
}

async function openStartupBook(): Promise<void> {
  const operation = ++openGeneration;
  setLoading(true);
  try {
    const manifest = await window.readerApi.startupBook();
    if (manifest && operation !== openGeneration) return void window.readerApi.closeBook(manifest.resourceId);
    if (manifest) await openBook(manifest, operation);
  } catch (error) {
    if (operation === openGeneration) handleOpenError(error);
  } finally {
    if (operation === openGeneration) setLoading(false);
  }
}

async function openExternalBook(manifest: BookManifest): Promise<void> {
  const operation = ++openGeneration;
  setLoading(true);
  try {
    if (operation !== openGeneration) return void window.readerApi.closeBook(manifest.resourceId);
    await openBook(manifest, operation);
  } finally {
    if (operation === openGeneration) setLoading(false);
  }
}

async function chooseBook(): Promise<void> {
  const operation = ++openGeneration;
  setLoading(true);
  try {
    const manifest = await window.readerApi.chooseBook();
    if (manifest && operation !== openGeneration) return void window.readerApi.closeBook(manifest.resourceId);
    if (manifest) await openBook(manifest, operation);
  } catch (error) {
    if (operation === openGeneration) handleOpenError(error);
  } finally {
    if (operation === openGeneration) setLoading(false);
  }
}

async function openBook(manifest: BookManifest, operation: number): Promise<void> {
  try {
    saveCurrentPosition();
    cleanupCurrentBook();
    currentBook = manifest;
    applyPreferences();
    titleLabel.textContent = manifest.title;
    welcome.hidden = true;
    progressLabel.textContent = "—";
    const state = loadBookState(manifest);

    if (manifest.kind === "cbz") await renderCbz(manifest, state);
    else if (manifest.kind === "epub") await renderEpub(manifest, state);
    else if (manifest.kind === "pdf") await renderPdf(manifest, state);
    else await renderText(manifest, state);

    document.title = `${manifest.title} — Scroll Reader`;
    window.readerApi.reportBookOpened(manifest.kind, manifest.title);
    showMessage(`Opened ${manifest.title}`, 1800);
  } catch (error) {
    if (operation === openGeneration) handleOpenError(error, manifest.resourceId);
    else void window.readerApi.closeBook(manifest.resourceId);
  }
}

function handleOpenError(error: unknown, resourceId?: string): void {
  if (resourceId) void window.readerApi.closeBook(resourceId);
  const detail = error instanceof Error ? error.message : String(error);
  window.readerApi.reportError(detail);
  showMessage(detail, 6000);
  cleanupCurrentBook();
  currentBook = null;
  applyPreferences();
  titleLabel.textContent = "Scroll Reader";
  progressLabel.textContent = "—";
  welcome.hidden = false;
}

async function renderCbz(book: BookManifest, state: StoredBookState | null): Promise<void> {
  reader.className = "reader cbz-reader is-preloading";
  reader.replaceChildren();
  window.scrollTo({ top: 0 });

  const fragment = document.createDocumentFragment();
  let loadedPages = 0;
  let retainedPixels = 0;
  const pending: Array<{ image: HTMLImageElement; shell: HTMLElement; index: number }> = [];
  progressLabel.textContent = `Loading 0 / ${book.pages.length}`;
  book.pages.forEach((page, index) => {
    const shell = document.createElement("div");
    shell.className = "page-shell";
    shell.dataset.pageIndex = String(index);
    shell.dataset.pageName = page.name;
    shell.style.aspectRatio = `${page.width} / ${page.height}`;
    shell.setAttribute("aria-label", `Page ${index + 1} of ${book.pages.length}`);

    const image = new Image();
    image.alt = `Page ${index + 1}`;
    image.loading = "eager";
    image.decoding = "async";
    pending.push({ image, shell, index });
    shell.append(image);
    fragment.append(shell);
  });
  reader.append(fragment);
  for (const { image, shell, index } of pending) {
    image.src = bookResourceUrl("cbz", book.resourceId, book.pages[index].name);
    const loaded = await waitForImageResult(image);
    if (currentBook !== book) return;
    if (loaded) {
      if (image.naturalWidth * image.naturalHeight > MAX_CBZ_PAGE_PIXELS) throw new Error(`CBZ page ${index + 1} exceeds the decoded-pixel safety limit.`);
      retainedPixels = addPixelBudget(retainedPixels, image.naturalWidth, image.naturalHeight, MAX_RETAINED_IMAGE_PIXELS, "CBZ decoded image data");
      shell.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
      shell.classList.add("is-loaded");
      await image.decode().catch(() => undefined);
    } else {
      shell.classList.add("has-error");
      shell.textContent = `Could not load page ${index + 1}`;
    }
    loadedPages += 1;
    progressLabel.textContent = `Loading ${loadedPages} / ${book.pages.length}`;
  }
  if (currentBook !== book) return;
  reader.classList.remove("is-preloading");

  const requestedPage = Math.min(book.pages.length - 1, Math.max(0, state?.cbzPage ?? 0));
  const requestedOffset = Math.min(1, Math.max(0, state?.cbzOffset ?? 0));
  setCbzPageCount(requestedPage);
  requestAnimationFrame(() => {
    const shell = pageShell(requestedPage);
    if (shell) window.scrollTo({ top: shell.offsetTop + shell.offsetHeight * requestedOffset });
    updateCbzViewport();
  });
}

function pageShell(index: number): HTMLElement | null {
  return reader.querySelector<HTMLElement>(`.page-shell[data-page-index="${index}"]`);
}

function currentCbzPosition(): { index: number; offset: number } {
  const shells = reader.querySelectorAll<HTMLElement>(".page-shell");
  const targetY = window.scrollY + 1;
  let current = shells[0];
  for (const shell of shells) {
    if (shell.offsetTop > targetY) break;
    current = shell;
  }
  if (!current) return { index: 0, offset: 0 };
  const index = Number(current.dataset.pageIndex ?? 0);
  const offset = current.offsetHeight ? (targetY - current.offsetTop) / current.offsetHeight : 0;
  return { index, offset: Math.min(1, Math.max(0, offset)) };
}

function updateCbzViewport(): void {
  if (currentBook?.kind !== "cbz") return;
  const { index } = currentCbzPosition();
  setCbzPageCount(index);
}

async function renderText(book: BookManifest, state: StoredBookState | null): Promise<void> {
  const text = await window.readerApi.readTextBook(book.resourceId);
  if (currentBook !== book) return;
  const article = document.createElement("article");
  article.className = "text-reader";
  article.textContent = text;
  reader.className = "reader";
  reader.replaceChildren(article);
  requestAnimationFrame(() => restoreScrollRatio(state?.scrollRatio ?? 0));
}

async function renderEpub(book: BookManifest, state: StoredBookState | null): Promise<void> {
  reader.className = "reader epub-reader is-preloading";
  reader.replaceChildren();
  window.scrollTo({ top: 0 });
  epubBook = ePub(bookResourceUrl("epub", book.resourceId));
  await epubBook.opened;
  if (currentBook !== book || !epubBook) return;
  const sections: Array<{ index: number; render(request: (path: string) => Promise<unknown>): Promise<string> }> = [];
  epubBook.spine.each((section) => sections.push(section));
  if (sections.length > MAX_EPUB_SECTIONS) throw new Error(`EPUB contains more than ${MAX_EPUB_SECTIONS} spine sections.`);
  progressLabel.textContent = `Loading 0 / ${sections.length}`;
  let totalMarkupBytes = 0;
  let retainedImagePixels = 0;

  for (let index = 0; index < sections.length; index += 1) {
    const markup = await sections[index].render(epubBook.load.bind(epubBook));
    const markupBytes = new TextEncoder().encode(markup).byteLength;
    if (markupBytes > MAX_EPUB_SECTION_MARKUP_BYTES) throw new Error(`EPUB section ${index + 1} exceeds the markup safety limit.`);
    totalMarkupBytes += markupBytes;
    if (totalMarkupBytes > MAX_EPUB_TOTAL_MARKUP_BYTES) throw new Error("EPUB rendered markup exceeds the aggregate safety limit.");
    if (currentBook !== book) return;
    retainedImagePixels = await appendEpubSection(markup, index, sections.length, retainedImagePixels);
    if (currentBook !== book) return;
    progressLabel.textContent = `Loading ${index + 1} / ${sections.length}`;
  }

  reader.classList.remove("is-preloading");
  const legacySection = epubSectionFromCfi(state?.epubCfi);
  const requestedSection = Math.min(sections.length - 1, Math.max(0, state?.epubSection ?? legacySection ?? 0));
  const requestedOffset = Math.min(1, Math.max(0, state?.epubOffset ?? 0));
  setEpubSectionCount(requestedSection);
  requestAnimationFrame(() => {
    const shell = epubSectionShell(requestedSection);
    if (shell) window.scrollTo({ top: shell.offsetTop + shell.offsetHeight * requestedOffset });
    updateEpubViewport();
  });
}

async function appendEpubSection(markup: string, index: number, total: number, retainedImagePixels: number): Promise<number> {
  const shell = document.createElement("section");
  shell.className = "epub-section-shell";
  shell.dataset.sectionIndex = String(index);
  shell.setAttribute("aria-label", `Section ${index + 1} of ${total}`);

  const frame = document.createElement("iframe");
  frame.className = "epub-section-frame";
  frame.title = `Section ${index + 1}`;
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("scrolling", "no");
  frame.style.height = `${window.innerHeight}px`;
  shell.append(frame);
  reader.append(shell);

  await new Promise<void>((resolve, reject) => {
    frame.addEventListener("load", () => resolve(), { once: true });
    frame.addEventListener("error", () => reject(new Error(`Could not render EPUB section ${index + 1}.`)), { once: true });
    frame.srcdoc = securedEpubMarkup(markup);
  });

  const documentInFrame = frame.contentDocument;
  if (!documentInFrame) throw new Error(`Could not access EPUB section ${index + 1}.`);
  applyEpubDocumentStyle(documentInFrame);
  const images = [...documentInFrame.images];
  images.forEach((image) => { image.loading = "eager"; });
  await Promise.all(images.map(waitForImage));
  for (const image of images) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      retainedImagePixels = addPixelBudget(retainedImagePixels, image.naturalWidth, image.naturalHeight, MAX_RETAINED_IMAGE_PIXELS, "EPUB decoded image data");
    }
  }
  await documentInFrame.fonts.ready;
  await nextAnimationFrame();
  fitEpubFrame(frame);
  await nextAnimationFrame();
  fitEpubFrame(frame);
  return retainedImagePixels;
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
  });
}

function waitForImageResult(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) return Promise.resolve(image.naturalWidth > 0);
  return new Promise((resolve) => {
    image.addEventListener("load", () => resolve(true), { once: true });
    image.addEventListener("error", () => resolve(false), { once: true });
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function applyEpubDocumentStyle(documentInFrame: Document): void {
  let style = documentInFrame.getElementById("scroll-reader-style") as HTMLStyleElement | null;
  if (!style) {
    style = documentInFrame.createElement("style");
    style.id = "scroll-reader-style";
    documentInFrame.head.append(style);
  }
  style.textContent = epubDocumentCss(preferences);
}

function fitEpubFrame(frame: HTMLIFrameElement): void {
  const documentInFrame = frame.contentDocument;
  if (!documentInFrame?.body) return;
  const body = documentInFrame.body;
  const bounds = body.getBoundingClientRect();
  const height = Math.max(body.scrollHeight, body.offsetHeight, Math.ceil(bounds.height), 1);
  frame.style.height = `${height}px`;
}

function refreshEpubFrames(): void {
  for (const frame of reader.querySelectorAll<HTMLIFrameElement>(".epub-section-frame")) {
    if (frame.contentDocument) applyEpubDocumentStyle(frame.contentDocument);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const frame of reader.querySelectorAll<HTMLIFrameElement>(".epub-section-frame")) fitEpubFrame(frame);
    updateEpubViewport();
  }));
}

function epubSectionShell(index: number): HTMLElement | null {
  return reader.querySelector<HTMLElement>(`.epub-section-shell[data-section-index="${index}"]`);
}

function currentEpubPosition(): { index: number; offset: number } {
  const shells = reader.querySelectorAll<HTMLElement>(".epub-section-shell");
  const targetY = window.scrollY + 1;
  let current = shells[0];
  for (const shell of shells) {
    if (shell.offsetTop > targetY) break;
    current = shell;
  }
  if (!current) return { index: 0, offset: 0 };
  const index = Number(current.dataset.sectionIndex ?? 0);
  const offset = current.offsetHeight ? (targetY - current.offsetTop) / current.offsetHeight : 0;
  return { index, offset: Math.min(1, Math.max(0, offset)) };
}

function updateEpubViewport(): void {
  if (currentBook?.kind !== "epub") return;
  setEpubSectionCount(currentEpubPosition().index);
}

async function renderPdf(book: BookManifest, state: StoredBookState | null): Promise<void> {
  reader.className = `reader pdf-reader is-preloading${preferences.pdfDark ? " pdf-dark" : ""}`;
  reader.replaceChildren();
  window.scrollTo({ top: 0 });
  progressLabel.textContent = "Loading PDF";

  const response = await fetch(bookResourceUrl("pdf", book.resourceId));
  if (!response.ok) throw new Error(`Could not read PDF (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (currentBook !== book) return;

  pdfLoadingTask = getDocument({ data: bytes, maxImageSize: 64_000_000, canvasMaxAreaInBytes: 128 * 1024 * 1024 });
  pdfDocument = await pdfLoadingTask.promise;
  if (currentBook !== book || !pdfDocument) return;

  const documentForBook = pdfDocument;
  const total = documentForBook.numPages;
  if (total > MAX_PDF_PAGES) throw new Error(`PDF contains more than ${MAX_PDF_PAGES} pages.`);
  const availableWidth = Math.min(Math.max(document.documentElement.clientWidth, 320), 1600);
  progressLabel.textContent = `Loading 0 / ${total}`;
  let retainedPixels = 0;

  for (let pageIndex = 0; pageIndex < total; pageIndex += 1) {
    const pageNumber = pageIndex + 1;
    const page = await documentForBook.getPage(pageNumber);
    if (currentBook !== book) return;
    const originalViewport = page.getViewport({ scale: 1 });
    const metrics = pdfRenderMetrics(
      originalViewport.width,
      originalViewport.height,
      availableWidth,
      window.devicePixelRatio,
    );
    retainedPixels = addPixelBudget(retainedPixels, metrics.pixelWidth, metrics.pixelHeight, MAX_PDF_RETAINED_PIXELS, "PDF canvas data");
    const viewport = page.getViewport({ scale: metrics.viewportScale });
    const shell = document.createElement("section");
    shell.className = "pdf-page-shell";
    shell.dataset.pageIndex = String(pageIndex);
    shell.style.aspectRatio = `${originalViewport.width} / ${originalViewport.height}`;
    shell.setAttribute("aria-label", `Page ${pageNumber} of ${total}`);

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    canvas.width = metrics.pixelWidth;
    canvas.height = metrics.pixelHeight;
    canvas.setAttribute("aria-label", `Page ${pageNumber}`);
    shell.append(canvas);
    reader.append(shell);

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(`Could not create a canvas for PDF page ${pageNumber}.`);
    const outputScale = metrics.outputScale;
    await page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      background: "#ffffff",
    }).promise;
    page.cleanup();
    if (currentBook !== book) return;
    progressLabel.textContent = `Loading ${pageNumber} / ${total}`;
  }

  reader.classList.remove("is-preloading");
  const requestedPage = Math.min(total - 1, Math.max(0, state?.pdfPage ?? 0));
  const requestedOffset = Math.min(1, Math.max(0, state?.pdfOffset ?? 0));
  setPdfPageCount(requestedPage);
  requestAnimationFrame(() => {
    const shell = pdfPageShell(requestedPage);
    if (shell) window.scrollTo({ top: shell.offsetTop + shell.offsetHeight * requestedOffset });
    updatePdfViewport();
  });
}

function pdfPageShell(index: number): HTMLElement | null {
  return reader.querySelector<HTMLElement>(`.pdf-page-shell[data-page-index="${index}"]`);
}

function currentPdfPosition(): { index: number; offset: number } {
  const shells = reader.querySelectorAll<HTMLElement>(".pdf-page-shell");
  const targetY = window.scrollY + 1;
  let current = shells[0];
  for (const shell of shells) {
    if (shell.offsetTop > targetY) break;
    current = shell;
  }
  if (!current) return { index: 0, offset: 0 };
  const index = Number(current.dataset.pageIndex ?? 0);
  const offset = current.offsetHeight ? (targetY - current.offsetTop) / current.offsetHeight : 0;
  return { index, offset: Math.min(1, Math.max(0, offset)) };
}

function updatePdfViewport(): void {
  if (currentBook?.kind !== "pdf") return;
  setPdfPageCount(currentPdfPosition().index);
}

function cleanupCurrentBook(): void {
  if (epubBook) epubBook.destroy();
  epubBook = null;
  if (pdfLoadingTask) void pdfLoadingTask.destroy();
  pdfLoadingTask = null;
  pdfDocument = null;
  reader.replaceChildren();
  reader.className = "reader";
  window.scrollTo({ top: 0 });
}

function bookResourceUrl(kind: "cbz" | "epub" | "pdf", resourceId: string, entry?: string): string {
  const parameters = new URLSearchParams({ id: resourceId });
  if (entry) parameters.set("entry", entry);
  return `scroll-reader-book://localhost/${kind}?${parameters.toString()}`;
}

function handleWindowScroll(): void {
  if (scrollFrame !== undefined) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = undefined;
    if (currentBook?.kind === "cbz") updateCbzViewport();
    else if (currentBook?.kind === "txt") setTextPageCount();
    else if (currentBook?.kind === "epub") updateEpubViewport();
    else if (currentBook?.kind === "pdf") updatePdfViewport();
    scheduleSave();
  });
}

function handleWindowResize(): void {
  if (currentBook?.kind === "cbz") updateCbzViewport();
  else if (currentBook?.kind === "txt") requestAnimationFrame(setTextPageCount);
  else if (currentBook?.kind === "epub") refreshEpubFrames();
  else if (currentBook?.kind === "pdf") updatePdfViewport();
}

function handlePointerMove(event: PointerEvent): void {
  if (event.clientY <= TOOLBAR_REVEAL_HEIGHT) showToolbar();
}

function saveCurrentPosition(): void {
  if (!currentBook) return;
  if (currentBook.kind === "cbz") {
    const { index, offset } = currentCbzPosition();
    saveBookState(currentBook, { cbzPage: index, cbzOffset: offset });
  } else if (currentBook.kind === "txt") {
    saveBookState(currentBook, {
      scrollRatio: scrollRatio(window.scrollY, document.documentElement.scrollHeight, window.innerHeight),
    });
  } else if (currentBook.kind === "epub") {
    const { index, offset } = currentEpubPosition();
    saveBookState(currentBook, { epubSection: index, epubOffset: offset });
  } else {
    const { index, offset } = currentPdfPosition();
    saveBookState(currentBook, { pdfPage: index, pdfOffset: offset });
  }
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCurrentPosition, 250);
}

function restoreScrollRatio(ratio: number): void {
  const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({ top: maximum * Math.min(1, Math.max(0, ratio)) });
  setTextPageCount();
}

function changeFontSize(delta: number): void {
  preferences.fontSize = clampFontSize((preferences.fontSize ?? STANDARD_FONT_SIZE) + delta);
  savePreferences(preferences);
  applyPreferences();
}

function resetBookFont(): void {
  preferences.fontSize = null;
  savePreferences(preferences);
  applyPreferences();
}

function cycleTextWidth(): void {
  preferences.textWidth = nextTextWidth(preferences.textWidth);
  savePreferences(preferences);
  applyPreferences();
}

function togglePdfColors(): void {
  preferences.pdfDark = !preferences.pdfDark;
  savePreferences(preferences);
  applyPreferences();
}

function applyPreferences(): void {
  const fontSize = preferences.fontSize ?? STANDARD_FONT_SIZE;
  const textWidth = preferences.textWidth ?? STANDARD_TEXT_WIDTH;
  document.documentElement.style.setProperty("--text-size", `${fontSize}px`);
  document.documentElement.style.setProperty("--text-width", `${textWidth}px`);
  fontLabel.textContent = preferences.fontSize === null && currentBook?.kind === "epub" ? "Book font" : `${fontSize} px`;
  widthButton.textContent = preferences.textWidth === null && currentBook?.kind === "epub" ? "Book width" : `Width ${textWidth}`;
  pdfColorsButton.hidden = currentBook?.kind !== "pdf";
  pdfColorsButton.textContent = preferences.pdfDark ? "PDF: dark" : "PDF: light";
  pdfColorsButton.setAttribute("aria-pressed", String(preferences.pdfDark));
  reader.classList.toggle("pdf-dark", currentBook?.kind === "pdf" && preferences.pdfDark);
  if (currentBook?.kind === "epub") refreshEpubFrames();
  if (currentBook?.kind === "txt") requestAnimationFrame(setTextPageCount);
}

async function toggleFullscreen(): Promise<void> {
  await window.readerApi.toggleFullscreen();
}

function handleKeydown(event: KeyboardEvent): void {
  showToolbar();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void chooseBook();
  } else if (event.key === "F11") {
    event.preventDefault();
    void toggleFullscreen();
  } else if (event.key === "+" || event.key === "=") {
    changeFontSize(2);
  } else if (event.key === "-") {
    changeFontSize(-2);
  } else if (event.key === "Home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function showToolbar(): void {
  toolbar.classList.remove("is-hidden");
  window.clearTimeout(toolbarTimer);
  if (currentBook && !document.body.classList.contains("is-loading")) scheduleToolbarHide();
}

function scheduleToolbarHide(): void {
  window.clearTimeout(toolbarTimer);
  if (!currentBook || document.body.classList.contains("is-loading")) return;
  toolbarTimer = window.setTimeout(() => {
    if (!toolbar.matches(":hover")) toolbar.classList.add("is-hidden");
  }, 1400);
}

function showMessage(text: string, duration: number): void {
  message.textContent = text;
  message.hidden = false;
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => {
    message.hidden = true;
  }, duration);
}

function setLoading(loading: boolean): void {
  document.body.classList.toggle("is-loading", loading);
  if (loading) {
    toolbar.classList.remove("is-hidden");
    window.clearTimeout(toolbarTimer);
  } else {
    scheduleToolbarHide();
  }
}

function setCbzPageCount(index: number): void {
  const total = Math.max(1, currentBook?.pages.length ?? 1);
  const page = Math.min(total, Math.max(1, Math.floor(index) + 1));
  progressLabel.textContent = `Page ${page} / ${total}`;
}

function setEpubSectionCount(index: number): void {
  const total = Math.max(1, epubBook?.spine.length ?? 1);
  const section = Math.min(total, Math.max(1, Math.floor(index) + 1));
  progressLabel.textContent = `Section ${section} / ${total}`;
}

function setPdfPageCount(index: number): void {
  const total = Math.max(1, pdfDocument?.numPages ?? 1);
  const page = Math.min(total, Math.max(1, Math.floor(index) + 1));
  progressLabel.textContent = `Page ${page} / ${total}`;
}

function setTextPageCount(): void {
  const viewport = Math.max(1, window.innerHeight);
  const total = Math.max(1, Math.ceil(document.documentElement.scrollHeight / viewport));
  const page = Math.min(total, Math.max(1, Math.floor(window.scrollY / viewport) + 1));
  progressLabel.textContent = `Page ${page} / ${total}`;
}

async function reportRefreshRate(): Promise<void> {
  const refreshRate = await measureRefreshRate();
  if (!refreshRate) return;
  document.documentElement.dataset.measuredRefreshRate = String(refreshRate);
  const refreshLabel = requiredElement("refresh-rate");
  refreshLabel.textContent = `${refreshRate} Hz`;
  refreshLabel.hidden = false;
  requiredElement("fullscreen").title = `Fullscreen (F11) · compositor measured near ${refreshRate} Hz`;
  window.readerApi.reportRefreshRate(refreshRate);
  console.info(`Scroll Reader repaint cadence: approximately ${refreshRate} Hz`);
}
