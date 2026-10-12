import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { env } from "./env";

/**
 * Content-addressed, write-once object store. Keys are SHA-256 digests, so an original can never
 * be overwritten in place; a corrected document is always a new object, and every read is
 * re-hashed. Local disk in development; any S3-compatible bucket (Supabase Storage, Cloudflare R2)
 * when OBJECT_STORE=s3.
 */
interface ObjectDriver {
  exists(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

function assertKey(key: string): void {
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid object key");
}

const fsDriver: ObjectDriver = {
  async exists(key) {
    try {
      await stat(fsPath(key));
      return true;
    } catch {
      return false;
    }
  },
  async put(key, bytes) {
    const file = fsPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
  },
  async get(key) {
    return new Uint8Array(await readFile(fsPath(key)));
  },
};

function fsPath(key: string): string {
  return path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().OBJECT_STORE_DIR), key.slice(0, 2), key);
}

let s3Client: AwsClient | null = null;

function s3(): { client: AwsClient; url: (key: string) => string } {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) throw new Error("OBJECT_STORE=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  s3Client ??= new AwsClient({ accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, sessionToken: e.S3_SESSION_TOKEN, region: e.S3_REGION, service: "s3" });
  const base = e.S3_ENDPOINT.replace(/\/+$/, "");
  return { client: s3Client, url: (key) => `${base}/${e.S3_BUCKET}/originals/${key.slice(0, 2)}/${key}` };
}

const s3Driver: ObjectDriver = {
  async exists(key) {
    const { client, url } = s3();
    const res = await client.fetch(url(key), { method: "HEAD" });
    return res.ok;
  },
  async put(key, bytes) {
    const { client, url } = s3();
    const res = await client.fetch(url(key), { method: "PUT", body: Buffer.from(bytes), headers: { "content-type": "application/octet-stream", "x-amz-meta-sha256": key } });
    if (!res.ok) throw new Error(`Object store write failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  },
  async get(key) {
    const { client, url } = s3();
    const res = await client.fetch(url(key));
    if (!res.ok) throw new Error(`Object ${key} unavailable (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
};

function driver(): ObjectDriver {
  return env().OBJECT_STORE === "s3" ? s3Driver : fsDriver;
}

export async function putObject(bytes: Uint8Array): Promise<{ key: string; sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const d = driver();
  if (!(await d.exists(sha256))) await d.put(sha256, bytes);
  return { key: sha256, sha256 };
}

export async function getObject(key: string): Promise<Uint8Array> {
  assertKey(key);
  const bytes = await driver().get(key);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== key) throw new Error(`Object ${key} failed integrity check`);
  return bytes;
}
