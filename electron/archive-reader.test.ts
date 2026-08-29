import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openZip } from "./archive-reader";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("file-handle ZIP reader", () => {
  it("reads through the selected handle without closing it", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scroll-reader-zip-"));
    temporaryDirectories.push(directory);
    const archivePath = path.join(directory, "empty.cbz");
    const emptyZip = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
    await fs.writeFile(archivePath, emptyZip);

    const handle = await fs.open(archivePath, "r");
    try {
      const zipFile = await openZip(handle, emptyZip.length, "CBZ");
      const closed = new Promise<void>((resolve) => zipFile.once("close", resolve));
      zipFile.readEntry();
      await closed;

      const signature = Buffer.alloc(4);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      expect(bytesRead).toBe(4);
      expect(signature.toString("ascii")).toBe("PK\u0005\u0006");
    } finally {
      await handle.close();
    }
  });
});
