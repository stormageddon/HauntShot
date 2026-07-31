/**
 * StoragePort — S3-compatible semantics.
 * R2 adapter today; swap endpoint/creds later for S3/B2 without touching routes.
 */
export interface StoredObject {
  key: string;
  contentType: string;
  byteSize: number;
}

export interface StoragePort {
  put(
    key: string,
    body: ArrayBuffer | Uint8Array | ReadableStream,
    contentType: string,
  ): Promise<StoredObject>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
