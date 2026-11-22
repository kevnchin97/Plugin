/**
 * Server-only S3 helpers (MinIO locally, S3/R2 in production). Import from
 * "@innovate/shared/storage"; never from client components.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
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

/**
 * Desktop app storage: objects are plain files under `dir` (keys are paths). Browsers reach them
 * through the web app's `/api/files/<key>` route with an HMAC-signed, expiring URL, the same
 * contract as S3 presigned URLs, so callers don't know the difference.
 */
export class LocalStorage {
  constructor(readonly config: { dir: string; secret: string; publicUrl: string; signedUrlTtl: number }) {}

  /**
   * Absolute path for a key; refuses keys that would escape the storage folder. Characters Windows
   * doesn't allow in file names (keys can hold e.g. "agent-export:…:gif") are %-encoded, as is "%".
   */
  pathFor(key: string): string {
    const parts = key.split("/");
    if (!key || parts.some((p) => !p || p === "." || p === "..")) throw new Error(`Bad storage key: ${key}`);
    return join(this.config.dir, ...parts.map(safeName));
  }

  async ensureBucket(): Promise<void> {
    await mkdir(this.config.dir, { recursive: true });
  }

  async uploadFile(key: string, file: string, _contentType: string): Promise<number> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.${Date.now()}.part`;
    await copyFile(file, tmp);
    await rename(tmp, dest);
    return (await stat(dest)).size;
  }

  async putStream(key: string, body: Readable, _contentType: string): Promise<void> {
    const dest = this.pathFor(key);
    await mkdir(dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.${Date.now()}.part`;
    await pipeline(body, createWriteStream(tmp));
    await rename(tmp, dest);
  }

  async downloadFile(key: string, file: string): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.part`;
    await copyFile(this.pathFor(key), tmp);
    await rename(tmp, file);
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const s = await stat(this.pathFor(key));
      return s.isFile() ? { size: s.size, contentType: contentTypeFor(key) } : null;
    } catch {
      return null;
    }
  }

  async signedGetUrl(key: string, opts: { downloadName?: string; expiresIn?: number } = {}): Promise<string> {
    return this.sign("GET", key, opts.expiresIn ?? this.config.signedUrlTtl, opts.downloadName);
  }

  async signedPutUrl(key: string, _contentType: string, expiresIn = 3600): Promise<string> {
    return this.sign("PUT", key, expiresIn);
  }

  private sign(method: "GET" | "PUT", key: string, expiresIn: number, downloadName?: string): string {
    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const qs = new URLSearchParams({ exp: String(exp) });
    if (downloadName) qs.set("dl", downloadName);
    qs.set("sig", localSignature(this.config.secret, method, key, exp, downloadName));
    return `${this.config.publicUrl.replace(/\/$/, "")}/api/files/${key.split("/").map(encodeURIComponent).join("/")}?${qs}`;
  }

  /** Checks a signed URL's parameters (used by the /api/files route). */
  verify(method: "GET" | "PUT", key: string, params: URLSearchParams): boolean {
    const exp = Number(params.get("exp"));
    const sig = params.get("sig") ?? "";
    if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
    const want = Buffer.from(localSignature(this.config.secret, method, key, exp, params.get("dl") ?? undefined));
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  }
}

/** One key segment as a file name every OS accepts: %-encode "%", Windows' reserved characters and control characters. */
function safeName(segment: string): string {
  let out = "";
  for (const c of segment) out += c === "%" || '<>:"\\|?*'.includes(c) || c.charCodeAt(0) < 32 ? `%${c.charCodeAt(0).toString(16).padStart(2, "0")}` : c;
  return out;
}

function localSignature(secret: string, method: string, key: string, exp: number, downloadName?: string) {
  return createHmac("sha256", secret).update(`${method}\n${key}\n${exp}\n${downloadName ?? ""}`).digest("base64url");
}

const TYPES: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4", mkv: "video/x-matroska",
  gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif",
  pdf: "application/pdf", json: "application/json", vtt: "text/vtt", m4a: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav",
};
export const contentTypeFor = (key: string) => TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export type AnyStorage = Storage | LocalStorage;

/** S3 (MinIO, S3, R2) unless STORAGE_DIR is set, which the desktop app does. */
export function storageFromEnv(env = process.env): AnyStorage {
  if (env.STORAGE_DIR) {
    const secret = env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set.");
    return new LocalStorage({ dir: env.STORAGE_DIR, secret, publicUrl: env.AUTH_URL ?? "http://localhost:3000", signedUrlTtl: Number(env.SIGNED_URL_TTL_SECONDS || 3600) });
  }
  return new Storage(storageConfigFromEnv(env));
}
