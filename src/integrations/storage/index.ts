// File storage behind a small interface so callers never know where bytes live.
// STORAGE_DRIVER=local (default): LocalDiskStorage, files under UPLOAD_DIR — no external dependency.
// STORAGE_DRIVER=r2: Cloudflare R2 (S3-compatible), see ./r2.ts. Nothing outside this module knows or
// cares which is active — same StorageProvider interface either way. Objects are always addressed by
// an opaque, server-generated `key` — never by a client-supplied filename.
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/config/env";
import { createR2StorageFromEnv } from "./r2";

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
}

export interface StorageProvider {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const EXT_TO_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

export class LocalDiskStorage implements StorageProvider {
  constructor(private readonly root: string) {}

  /** Resolves a key inside the root, refusing anything that would escape it. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put({ key, body, contentType }: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, { flag: "wx" });
    return { key, contentType, size: body.length };
  }

  async get(key: string) {
    try {
      const body = await fs.readFile(this.resolve(key));
      return { body, contentType: EXT_TO_TYPE[path.extname(key).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

let instance: StorageProvider | undefined;
export function createStorageFromEnv(): StorageProvider {
  if (env.storage.driver === "r2") return createR2StorageFromEnv();
  return new LocalDiskStorage(env.storage.localDir);
}

export function getStorage(): StorageProvider {
  if (!instance) instance = createStorageFromEnv();
  return instance;
}

/** Test hook. */
export function setStorage(provider: StorageProvider | undefined): void {
  instance = provider;
}

const SIGNATURES: Array<{ type: string; ext: string; match: (b: Buffer) => boolean }> = [
  { type: "image/jpeg", ext: ".jpg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", ext: ".png", match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/webp", ext: ".webp", match: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { type: "application/pdf", ext: ".pdf", match: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

/** Detects the real file type from magic bytes (the client-declared mimetype/filename are not trusted). */
export function sniffFileType(body: Buffer): { type: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => s.match(body));
  return hit ? { type: hit.type, ext: hit.ext } : null;
}
