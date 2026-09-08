import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isObjectKey } from "./keys.ts";

export const MAX_PRESIGN_SECONDS = 3600;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PutOptions {
  contentType: string;
  sha256?: string;
}

export interface ObjectHead {
  bytes: number;
  contentType: string | null;
  sha256: string | null;
}

/** The single S3 boundary (spec §3.2); swap the store by reimplementing this interface. */
export interface Storage {
  readonly bucket: string;
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<void>;
  /** Streams a local file in without buffering it (downloads up to 200 MiB, spec §10.2.9). */
  putFile(key: string, path: string, options: PutOptions): Promise<void>;
  getBytes(key: string): Promise<Uint8Array>;
  /** Streams an object, so web never buffers a large PDF per request (preflight S8). A missing key rejects with ObjectNotFound. */
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;
  head(key: string): Promise<ObjectHead | null>;
  delete(key: string): Promise<void>;
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  ping(): Promise<void>;
}

function assertKey(key: string): void {
  if (!isObjectKey(key)) throw new TypeError("invalid object key");
}

/** getStream's answer for a key that holds no object, so callers can tell it from an unreachable store. */
export class ObjectNotFound extends Error {
  constructor() {
    super("object not found");
    this.name = "ObjectNotFound";
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NotFound" || error.$metadata.httpStatusCode === 404)
  );
}

export function createStorage(config: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const Bucket = config.bucket;
  return {
    bucket: Bucket,
    async put(key, body, options) {
      assertKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          Metadata: options.sha256 ? { sha256: options.sha256 } : undefined,
        }),
      );
    },
    async putFile(key, path, options) {
      assertKey(key);
      const { size } = await stat(path);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: size,
          ContentType: options.contentType,
          Metadata: options.sha256 ? { sha256: options.sha256 } : undefined,
        }),
      );
    },
    async getBytes(key) {
      assertKey(key);
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      if (!response.Body) throw new Error("object has no body");
      return response.Body.transformToByteArray();
    },
    async getStream(key) {
      assertKey(key);
      const response = await client
        .send(new GetObjectCommand({ Bucket, Key: key }))
        .catch((error: unknown) => {
          throw isNotFound(error) ? new ObjectNotFound() : error;
        });
      if (!response.Body) throw new Error("object has no body");
      return response.Body.transformToWebStream() as ReadableStream<Uint8Array>;
    },
    async head(key) {
      assertKey(key);
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          bytes: response.ContentLength ?? 0,
          contentType: response.ContentType ?? null,
          sha256: response.Metadata?.sha256 ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignGet(key, ttlSeconds) {
      assertKey(key);
      if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_PRESIGN_SECONDS) {
        throw new RangeError(`ttlSeconds must be an integer from 1 to ${MAX_PRESIGN_SECONDS}`);
      }
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: ttlSeconds,
      });
    },
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }));
    },
  };
}
