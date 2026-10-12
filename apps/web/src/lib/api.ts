"use client";

import type { ApiErrorBody, ApiErrorCode } from "@plimsoll/domain";

export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details: unknown,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get contractError(): string | null {
    const d = this.details as { contractError?: string | null } | undefined;
    return d?.contractError ?? null;
  }
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  /** Adds an Idempotency-Key so a double-click or retry cannot repeat a mutation. */
  idempotencyKey?: string;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  if (!res.ok) {
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = (await res.json()) as ApiErrorBody;
    } catch {
      parsed = null;
    }
    const e = parsed?.error;
    throw new ApiClientError(e?.code ?? "INTERNAL", e?.message ?? `Request failed (${res.status})`, res.status, e?.details, e?.requestId ?? res.headers.get("x-request-id"));
  }
  return (await res.json()) as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.contractError ? `Contract rejected: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}
