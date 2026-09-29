import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { env } from "@/config/env";
import { LocalDiskStorage, createStorageFromEnv } from "@/integrations/storage";

const ORIGINAL_DRIVER = env.storage.driver;
const ORIGINAL_R2 = { ...env.storage.r2 };

function restoreEnv() {
  env.storage.driver = ORIGINAL_DRIVER;
  env.storage.r2 = { ...ORIGINAL_R2 };
}

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("createStorageFromEnv()", () => {
  it("returns LocalDiskStorage when STORAGE_DRIVER=local (default)", () => {
    env.storage.driver = "local";
    expect(createStorageFromEnv()).toBeInstanceOf(LocalDiskStorage);
  });

  it("throws a clear error when STORAGE_DRIVER=r2 but R2 vars are missing", () => {
    env.storage.driver = "r2";
    env.storage.r2 = { accountId: undefined, accessKeyId: undefined, secretAccessKey: undefined, bucket: undefined };
    expect(() => createStorageFromEnv()).toThrow(/R2_ACCOUNT_ID.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*R2_BUCKET/);
  });

  it("throws listing only the specific vars that are missing", () => {
    env.storage.driver = "r2";
    env.storage.r2 = { accountId: "acc123", accessKeyId: "key", secretAccessKey: undefined, bucket: "docs" };
    expect(() => createStorageFromEnv()).toThrow(/R2_SECRET_ACCESS_KEY/);
    expect(() => createStorageFromEnv()).not.toThrow(/R2_ACCOUNT_ID/);
  });
});

describe("R2Storage", () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockReset();
    // The top-of-file static import already loaded the real "./r2" + "@aws-sdk/client-s3" into
    // Vitest's module cache — reset it here (not just in the shared afterEach) so THIS test's
    // upcoming dynamic import() below actually picks up the mock registered just after this line,
    // even on the very first test in this describe block.
    vi.resetModules();
    vi.doMock("@aws-sdk/client-s3", () => {
      class FakeS3Client {
        send = send;
      }
      class Cmd {
        input: unknown;
        constructor(input: unknown) {
          this.input = input;
        }
      }
      class NoSuchKey extends Error {
        name = "NoSuchKey";
      }
      return {
        S3Client: FakeS3Client,
        PutObjectCommand: class extends Cmd {},
        GetObjectCommand: class extends Cmd {},
        DeleteObjectCommand: class extends Cmd {},
        NoSuchKey,
      };
    });
  });

  async function buildStorage() {
    const { R2Storage } = await import("@/integrations/storage/r2");
    return new R2Storage({ accountId: "acc123", accessKeyId: "key", secretAccessKey: "secret", bucket: "documents" });
  }

  it("put() sends a PutObjectCommand with the bucket/key/body/contentType and returns the stored object", async () => {
    send.mockResolvedValueOnce({});
    const storage = await buildStorage();
    const body = Buffer.from("hello");
    const result = await storage.put({ key: "drivers/abc/licence.jpg", body, contentType: "image/jpeg" });

    expect(result).toEqual({ key: "drivers/abc/licence.jpg", contentType: "image/jpeg", size: body.length });
    expect(send).toHaveBeenCalledTimes(1);
    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input).toMatchObject({
      Bucket: "documents",
      Key: "drivers/abc/licence.jpg",
      ContentType: "image/jpeg",
    });
  });

  it("get() streams the object body into a Buffer and returns its content type", async () => {
    const stream = Readable.from([Buffer.from("hel"), Buffer.from("lo")]);
    send.mockResolvedValueOnce({ Body: stream, ContentType: "image/png" });
    const storage = await buildStorage();

    const result = await storage.get("drivers/abc/licence.jpg");
    expect(result).toEqual({ body: Buffer.from("hello"), contentType: "image/png" });
  });

  it("get() returns null when the object doesn't exist (NoSuchKey)", async () => {
    const { NoSuchKey } = (await import("@aws-sdk/client-s3")) as unknown as { NoSuchKey: new () => Error };
    send.mockRejectedValueOnce(new NoSuchKey());
    const storage = await buildStorage();

    expect(await storage.get("missing/key.jpg")).toBeNull();
  });

  it("get() rethrows any other error", async () => {
    send.mockRejectedValueOnce(new Error("network down"));
    const storage = await buildStorage();

    await expect(storage.get("drivers/abc/licence.jpg")).rejects.toThrow("network down");
  });

  it("delete() sends a DeleteObjectCommand for the bucket/key", async () => {
    send.mockResolvedValueOnce({});
    const storage = await buildStorage();
    await storage.delete("drivers/abc/licence.jpg");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "documents", Key: "drivers/abc/licence.jpg" });
  });
});
