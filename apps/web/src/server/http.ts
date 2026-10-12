import { randomUUID, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import type { ApiErrorBody, ApiErrorCode } from "@plimsoll/domain";
import { isChainRejected, isRpcUnavailable } from "@plimsoll/stellar";
import { db, ensureMigrated, schema } from "./db/client";
import { apiKeySession, currentSession, type SessionContext } from "./auth/session";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ROLE_DENIED: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  TERMS_VERSION_STALE: 409,
  SIGNATURE_EXPIRED: 409,
  TOKEN_NOT_ALLOWLISTED: 422,
  MILESTONE_DISPUTED: 409,
  APPROVAL_QUORUM_MISSING: 409,
  EVIDENCE_DIGEST_MISMATCH: 409,
  EVIDENCE_NOT_READY: 409,
  CHAIN_PENDING: 202,
  CHAIN_REJECTED: 409,
  RPC_UNAVAILABLE: 503,
  ALREADY_SETTLED: 409,
  RECONCILIATION_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  WALLET_REQUIRED: 409,
  TRUSTLINE_MISSING: 409,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) return new ApiError("VALIDATION_FAILED", "Request validation failed.", e.issues);
  if (isChainRejected(e)) {
    return new ApiError("CHAIN_REJECTED", e.message, { stage: e.stage, contractError: e.contractError, txHash: e.txHash });
  }
  if (e instanceof Error && /Account not found/i.test(e.message)) return new ApiError("WALLET_REQUIRED", "This Stellar account does not exist on the network yet. Fund it (testnet: friendbot) before signing.");
  if (isRpcUnavailable(e)) return new ApiError("RPC_UNAVAILABLE", "Stellar RPC is unavailable. Status is unknown until it recovers; nothing has been assumed.");
  console.error(e);
  return new ApiError("INTERNAL", "Unexpected server error.");
}

export function errorResponse(e: unknown, requestId: string): NextResponse<ApiErrorBody> {
  const err = toApiError(e);
  const retryable = err.code === "RPC_UNAVAILABLE" || err.code === "CHAIN_PENDING";
  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details, requestId, retryable } },
    { status: STATUS[err.code], headers: { "x-request-id": requestId } },
  );
}

interface HandlerContext<P> {
  req: NextRequest;
  params: P;
  requestId: string;
}

type Handler<P, R> = (ctx: HandlerContext<P> & { session: SessionContext }) => Promise<R>;
type PublicHandler<P, R> = (ctx: HandlerContext<P> & { session: SessionContext | null }) => Promise<R>;

interface Options {
  /** Business mutations replay the stored response for a repeated Idempotency-Key. */
  idempotent?: boolean;
}

async function run<P, R>(req: NextRequest, rawParams: Promise<P>, requireAuth: boolean, opts: Options, fn: PublicHandler<P, R>): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  try {
    await ensureMigrated();
    const params = await rawParams;
    const session = (await currentSession()) ?? (await apiKeySession(req.headers.get("authorization")));
    if (requireAuth && !session) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.");

    const idemKey = opts.idempotent ? req.headers.get("idempotency-key") : null;
    if (idemKey && session) {
      const body = await req.clone().text();
      const scope = `${session.org?.id ?? "none"}:${session.user.id}:${req.method}:${req.nextUrl.pathname}`;
      const requestHash = createHash("sha256").update(body).digest("hex");
      const [existing] = await db().select().from(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.scope, scope), eq(schema.idempotencyKeys.key, idemKey)));
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was reused with a different request body.");
        if (existing.responseStatus === null) throw new ApiError("CHAIN_PENDING", "The original request is still processing.");
        return NextResponse.json(existing.responseBody, { status: existing.responseStatus, headers: { "x-request-id": requestId, "idempotent-replay": "true" } });
      }
      await db().insert(schema.idempotencyKeys).values({ scope, key: idemKey, requestHash });
      try {
        const result = await fn({ req, params, requestId, session });
        await db().update(schema.idempotencyKeys).set({ responseStatus: 200, responseBody: result as object }).where(and(eq(schema.idempotencyKeys.scope, scope), eq(schema.idempotencyKeys.key, idemKey)));
        return NextResponse.json(result, { headers: { "x-request-id": requestId } });
      } catch (e) {
        await db().delete(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.scope, scope), eq(schema.idempotencyKeys.key, idemKey)));
        throw e;
      }
    }

    const result = await fn({ req, params, requestId, session });
    if (result instanceof Response) return result;
    return NextResponse.json(result, { headers: { "x-request-id": requestId } });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

export function route<P = Record<string, never>, R = unknown>(fn: Handler<P, R>, opts: Options = {}) {
  return (req: NextRequest, ctx: { params: Promise<P> }) =>
    run<P, R>(req, ctx?.params ?? Promise.resolve({} as P), true, opts, (c) => fn({ ...c, session: c.session! }));
}

export function publicRoute<P = Record<string, never>, R = unknown>(fn: PublicHandler<P, R>) {
  return (req: NextRequest, ctx: { params: Promise<P> }) => run<P, R>(req, ctx?.params ?? Promise.resolve({} as P), false, {}, fn);
}

export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be JSON.");
  }
  return schema.parse(json);
}
