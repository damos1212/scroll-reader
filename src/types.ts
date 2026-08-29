export type BookKind = "cbz" | "epub" | "pdf" | "txt";

export interface PageMeta {
  name: string;
  mime: string;
  width: number;
  height: number;
}

export interface BookManifest {
  bookId: string;
  resourceId: string;
  title: string;
  kind: BookKind;
  modifiedMs: number;
  pages: PageMeta[];
}

export interface ReadingPosition {
  cbzPage?: number;
  cbzOffset?: number;
  epubCfi?: string;
  epubSection?: number;
  epubOffset?: number;
  pdfPage?: number;
  pdfOffset?: number;
  scrollRatio?: number;
}

export interface ReaderPreferences {
  fontSize: number | null;
  textWidth: number | null;
  pdfDark: boolean;
}

export interface StoredBookState extends ReadingPosition {
  version: 1;
}
