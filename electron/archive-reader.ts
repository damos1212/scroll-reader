import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import yauzl, { type ZipFile } from "yauzl";

class FileHandleZipReader extends yauzl.RandomAccessReader {
  constructor(private readonly handle: FileHandle) {
    super();
  }

  _readStreamForRange(start: number, end: number) {
    const handle = this.handle;
    let position = start;
    return new Readable({
      read(requestedBytes) {
        if (position >= end) return this.push(null);
        const length = Math.min(end - position, Math.max(1, Math.min(requestedBytes, 64 * 1024)));
        const buffer = Buffer.allocUnsafe(length);
        void handle.read(buffer, 0, length, position).then(({ bytesRead }) => {
          if (!bytesRead) return this.destroy(new Error("The selected book ended during an archive read."));
          position += bytesRead;
          this.push(buffer.subarray(0, bytesRead));
        }, (error) => this.destroy(error));
      },
    });
  }
}

export function openZip(handle: FileHandle, size: number, label: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileHandleZipReader(handle);
    yauzl.fromRandomAccessReader(reader, size, { lazyEntries: true, autoClose: true }, (error, zipFile) => {
      if (error || !zipFile) reject(new Error(`Invalid ${label} archive: ${error?.message ?? "unknown error"}`));
      else resolve(zipFile);
    });
  });
}
