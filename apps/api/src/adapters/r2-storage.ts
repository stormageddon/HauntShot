import type { StoragePort, StoredObject } from "../ports/storage";

/** Cloudflare R2 binding adapter (S3-compatible API under the hood). */
export class R2Storage implements StoragePort {
  constructor(private readonly bucket: R2Bucket) {}

  async put(
    key: string,
    body: ArrayBuffer | Uint8Array | ReadableStream,
    contentType: string,
  ): Promise<StoredObject> {
    const result = await this.bucket.put(key, body, {
      httpMetadata: { contentType },
    });
    return {
      key,
      contentType,
      byteSize: result.size,
    };
  }

  async get(
    key: string,
  ): Promise<{ body: ReadableStream; contentType: string } | null> {
    const obj = await this.bucket.get(key);
    if (!obj || !obj.body) return null;
    return {
      body: obj.body,
      contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
