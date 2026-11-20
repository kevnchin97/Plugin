/**
 * Server-only S3 helpers (MinIO locally, S3/R2 in production). Import from
 * "@innovate/shared/storage"; never from client components.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { rename, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  signedUrlTtl: number;
}

export function storageConfigFromEnv(env = process.env): StorageConfig {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set. Copy .env.example to .env.`);
    return v;
  };
  return {
    endpoint: env.S3_ENDPOINT || undefined,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || "us-east-1",
    bucket: need("S3_BUCKET"),
    accessKeyId: need("S3_ACCESS_KEY_ID"),
    secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    signedUrlTtl: Number(env.SIGNED_URL_TTL_SECONDS || 3600),
  };
}

export class Storage {
  readonly client: S3Client;
  /** Signs URLs with the host browsers can reach (may differ from the internal endpoint). */
  private readonly signer: S3Client;
  private bucketReady: Promise<void> | null = null;

  constructor(readonly config: StorageConfig) {
    const base = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.signer = new S3Client({ ...base, endpoint: config.publicEndpoint });
  }

  /** Creates the bucket on first use (local MinIO). In production the bucket should already exist. */
  ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket })).catch((err: { name?: string }) => {
          if (err.name !== "BucketAlreadyOwnedByYou" && err.name !== "BucketAlreadyExists") throw err;
        });
      }
    })().catch((err) => {
      this.bucketReady = null;
      throw err;
    });
    return this.bucketReady;
  }

  async uploadFile(key: string, file: string, contentType: string): Promise<number> {
    await this.ensureBucket();
    const { size } = await stat(file);
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.config.bucket, Key: key, Body: createReadStream(file), ContentType: contentType },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
    });
    await upload.done();
    return size;
  }

  async putStream(key: string, body: Readable, contentType: string): Promise<void> {
    await this.ensureBucket();
    await new Upload({ client: this.client, params: { Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType } }).done();
  }

  /** Download to `file` atomically (temp name + rename), so concurrent readers never see partial files. */
  async downloadFile(key: string, file: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object: ${key}`);
    const tmp = `${file}.${process.pid}.${Date.now()}.part`;
    await pipeline(res.Body as Readable, createWriteStream(tmp));
    await rename(tmp, file);
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  signedGetUrl(key: string, opts: { downloadName?: string; expiresIn?: number } = {}): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentDisposition: opts.downloadName
          ? `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, "")}"`
          : undefined,
      }),
      { expiresIn: opts.expiresIn ?? this.config.signedUrlTtl },
    );
  }

  async signedPutUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
    await this.ensureBucket();
    return getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.config.bucket, Key: key, ContentType: contentType }), {
      expiresIn,
    });
  }
}
