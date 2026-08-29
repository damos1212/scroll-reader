declare module "epubjs" {
  interface SpineSection {
    index: number;
    render(request: (path: string) => Promise<unknown>): Promise<string>;
  }

  interface Book {
    spine: {
      length: number;
      each(callback: (section: SpineSection) => void): void;
    };
    load(path: string): Promise<unknown>;
    destroy(): void;
    opened: Promise<void>;
    ready: Promise<void>;
  }

  export default function ePub(input: string | ArrayBuffer): Book;
}
