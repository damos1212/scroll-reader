import type { BookManifest } from "./types";

interface ReaderApi {
  chooseBook(): Promise<BookManifest | null>;
  openDroppedBook(file: File): Promise<BookManifest>;
  readTextBook(resourceId: string): Promise<string>;
  closeBook(resourceId: string): Promise<void>;
  startupBook(): Promise<BookManifest | null>;
  onOpenBook(callback: (manifest: BookManifest) => void): () => void;
  toggleFullscreen(): Promise<void>;
  reportRefreshRate(rate: number): void;
  reportBookOpened(kind: string, title: string): void;
  reportError(detail: string): void;
}

declare global {
  interface Window {
    readerApi: ReaderApi;
  }
}

export {};
