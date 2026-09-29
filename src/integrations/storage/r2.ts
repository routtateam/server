// Cloudflare R2 storage — S3-compatible, so the AWS SDK talks to it directly against R2's
// S3 API endpoint (https://developers.cloudflare.com/r2/api/s3/api/). No presigned URLs: objects
// are private, streamed through the backend's own authenticated /api/v1/files route (owner or an
// admin with verifications.view — see src/modules/files), exactly like LocalDiskStorage. This keeps
// the access-control model identical regardless of which StorageProvider is active.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import { env } from "@/config/env";
import type { StorageProvider, StoredObject } from "./index";

function bodyToBuffer(body: unknown): Promise<Buffer> {
  // The SDK's GetObjectCommand response body is a Node Readable in this runtime (not a browser
  // ReadableStream/Blob) — Node's client-s3 package targets that shape. transformToByteArray()
  // would also work but requires the response's stream-mixin helpers; collecting chunks is simpler
  // to unit-test with a plain mock stream.
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = body as NodeJS.ReadableStream;
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export class R2Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put({ key, body, contentType }: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
    );
    return { key, contentType, size: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = await bodyToBuffer(res.Body);
      return { body, contentType: res.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Builds an R2Storage from env, or throws with a clear message if any required var is missing. */
export function createR2StorageFromEnv(): R2Storage {
  const { accountId, accessKeyId, secretAccessKey, bucket } = env.storage.r2;
  const missing = [
    !accountId && "R2_ACCOUNT_ID",
    !accessKeyId && "R2_ACCESS_KEY_ID",
    !secretAccessKey && "R2_SECRET_ACCESS_KEY",
    !bucket && "R2_BUCKET",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=r2 but missing env var(s): ${missing.join(", ")}`);
  }
  return new R2Storage({ accountId: accountId!, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, bucket: bucket! });
}
