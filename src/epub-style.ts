import type { ReaderPreferences } from "./types";

const EPUB_FRAME_CSP = "default-src 'none'; img-src scroll-reader-book: blob:; font-src blob: data:; style-src 'unsafe-inline' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'";

export function securedEpubMarkup(markup: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${EPUB_FRAME_CSP}">${markup}`;
}

export function epubDocumentCss(preferences: ReaderPreferences): string {
  const width = preferences.textWidth === null
    ? ""
    : `max-width:${preferences.textWidth}px !important;margin-left:auto !important;margin-right:auto !important;`;
  const fontSize = preferences.fontSize === null ? "" : `font-size:${preferences.fontSize}px !important;`;
  return `
    html,body{background:#000 !important;color:#f2f2f2 !important;overflow:hidden !important;}
    body{${width}${fontSize}}
    img,svg{max-width:100% !important;height:auto !important;}
    a{color:#ddd !important;}
  `;
}
