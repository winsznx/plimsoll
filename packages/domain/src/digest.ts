/**
 * Canonical hashing shared by server, browser and verification scripts. Every digest is
 * domain-separated so a terms digest can never be replayed as an evidence digest.
 */

export type Canonical = string | number | boolean | null | Canonical[] | { [key: string]: Canonical };

export function canonicalJson(value: Canonical): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`Canonical JSON only allows safe integers, got ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k]!)}`).join(",")}}`;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

export async function domainDigest(domain: DigestDomain, payload: Canonical): Promise<string> {
  return sha256Hex(`${domain}\u0000${canonicalJson(payload)}`);
}

export const DIGEST_DOMAINS = {
  deal: "plimsoll:deal:v1",
  terms: "plimsoll:terms:v1",
  evidence: "plimsoll:evidence:v1",
  dispute: "plimsoll:dispute-reason:v1",
} as const;
export type DigestDomain = (typeof DIGEST_DOMAINS)[keyof typeof DIGEST_DOMAINS];

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) throw new TypeError("Invalid hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function isDigestHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
