import type { BookManifest, ReaderPreferences, StoredBookState } from "./types";

const PREFS_KEY = "scroll-reader:preferences:v2";
const DEFAULT_PREFERENCES: ReaderPreferences = { fontSize: 22, textWidth: 760, pdfDark: false, zoomFactor: 1 };
const TEXT_WIDTHS = [760, 860, 680] as const;

export function clampFontSize(value: number): number {
  return Math.min(40, Math.max(14, Math.round(value)));
}

export function clampZoomFactor(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(3, Math.max(0.5, Math.round(value * 10) / 10));
}

export function normalizeTextWidth(value: unknown): number | null {
  return typeof value === "number" && TEXT_WIDTHS.includes(value as typeof TEXT_WIDTHS[number]) ? value : null;
}

export function nextTextWidth(value: number | null): number | null {
  const normalized = normalizeTextWidth(value);
  if (normalized === null) return TEXT_WIDTHS[0];
  const index = TEXT_WIDTHS.indexOf(normalized as typeof TEXT_WIDTHS[number]);
  return index === TEXT_WIDTHS.length - 1 ? null : TEXT_WIDTHS[index + 1];
}

export function loadPreferences(storage: Storage = localStorage): ReaderPreferences {
  try {
    const serialized = storage.getItem(PREFS_KEY);
    if (serialized === null) return { ...DEFAULT_PREFERENCES };
    const stored = JSON.parse(serialized) as Partial<ReaderPreferences> | null;
    return {
      fontSize: typeof stored?.fontSize === "number" ? clampFontSize(stored.fontSize) : null,
      textWidth: normalizeTextWidth(stored?.textWidth),
      pdfDark: stored?.pdfDark === true,
      zoomFactor: typeof stored?.zoomFactor === "number" ? clampZoomFactor(stored.zoomFactor) : 1,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: ReaderPreferences, storage: Storage = localStorage): void {
  storage.setItem(PREFS_KEY, JSON.stringify(preferences));
}

export function bookStateKey(book: Pick<BookManifest, "bookId">): string {
  return `scroll-reader:book:v2:${book.bookId}`;
}

export function loadBookState(
  book: Pick<BookManifest, "bookId">,
  storage: Storage = localStorage,
): StoredBookState | null {
  try {
    return parseBookState(storage.getItem(bookStateKey(book)));
  } catch {
    return null;
  }
}

export function saveBookState(
  book: Pick<BookManifest, "bookId">,
  state: Omit<StoredBookState, "version">,
  storage: Storage = localStorage,
): void {
  storage.setItem(bookStateKey(book), JSON.stringify({ version: 1, ...state } satisfies StoredBookState));
}

function parseBookState(value: string | null): StoredBookState | null {
  const parsed = JSON.parse(value ?? "null") as StoredBookState | null;
  return parsed?.version === 1 ? parsed : null;
}

export function scrollRatio(scrollTop: number, scrollHeight: number, viewportHeight: number): number {
  const maximum = Math.max(0, scrollHeight - viewportHeight);
  return maximum === 0 ? 0 : Math.min(1, Math.max(0, scrollTop / maximum));
}

export function epubSectionFromCfi(cfi: string | undefined): number | null {
  const spineStep = cfi?.match(/^epubcfi\(\/\d+\/(\d+)/)?.[1];
  if (!spineStep) return null;
  return Math.max(0, Math.floor(Number(spineStep) / 2) - 1);
}
