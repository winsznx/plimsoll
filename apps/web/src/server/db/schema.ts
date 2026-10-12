import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ChainSnapshot, DealTerms, EvidenceManifest, FindingSide, SourceSpan } from "@plimsoll/domain";

/** Everything lives in its own schema so Plimsoll can share a Postgres instance safely. */
export const plimsoll = pgSchema("plimsoll");

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Token amounts in smallest units. 64-bit covers ~922 billion units at 7 decimals. */
const units = (name: string) => bigint(name, { mode: "bigint" });
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (v) => Buffer.from(v),
  fromDriver: (v) => new Uint8Array(v),
});

/** ChainSnapshot with bigints serialized as decimal strings for JSON storage. */
export type StoredSnapshot = Omit<ChainSnapshot, "agreement" | "milestones" | "balance"> & {
  agreement: Omit<ChainSnapshot["agreement"], "total" | "funded" | "released" | "refunded"> & { total: string; funded: string; released: string; refunded: string };
  milestones: (Omit<ChainSnapshot["milestones"][number], "amount"> & { amount: string })[];
  balance: string;
};

export const organizations = plimsoll.table("organizations", {
  id: id(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  /** "verified" is reserved for completed business identity verification; email never grants it. */
  verificationState: text("verification_state", { enum: ["unverified", "sample_fixture", "verified"] }).notNull().default("unverified"),
  createdAt: createdAt(),
});

export const users = plimsoll.table("users", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Set when the user proves control of the address; gates creating and submitting deals. */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  createdAt: createdAt(),
});

/** Single-use links proving control of a user's email address. Only the SHA-256 of the token is stored. */
export const emailVerifications = plimsoll.table(
  "email_verifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_verifications_user").on(t.userId)],
);

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const memberships = plimsoll.table(
  "memberships",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ORG_ROLES }).notNull(),
    status: text("status", { enum: ["active", "invited", "removed"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

/** Pending invitations to join an organization. Only the SHA-256 of the emailed token is stored. */
export const orgInvites = plimsoll.table(
  "org_invites",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    role: text("role", { enum: ORG_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("org_invites_org").on(t.orgId)],
);

export const passkeys = plimsoll.table("passkeys", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: bytea("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const authChallenges = plimsoll.table("auth_challenges", {
  id: id(),
  challenge: text("challenge").notNull().unique(),
  purpose: text("purpose", { enum: ["registration", "authentication"] }).notNull(),
  userId: uuid("user_id"),
  pendingEmail: text("pending_email"),
  pendingName: text("pending_name"),
  pendingOrg: jsonb("pending_org").$type<{ legalName: string; jurisdiction: string }>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sessions = plimsoll.table("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  activeOrgId: uuid("active_org_id").references(() => organizations.id),
  method: text("method", { enum: ["passkey", "demo"] }).notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const wallets = plimsoll.table(
  "wallets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    address: text("address").notNull(),
    network: text("network").notNull(),
    /** demo_custodial keys exist only for seeded testnet personas and are labelled everywhere. */
    accountKind: text("account_kind", { enum: ["external", "demo_custodial"] }).notNull(),
    label: text("label").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("wallets_address_network").on(t.address, t.network)],
);

export const counterparties = plimsoll.table(
  "counterparties",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    counterpartyOrgId: uuid("counterparty_org_id").notNull().references(() => organizations.id),
    relationship: text("relationship", { enum: ["supplier", "buyer", "inspector", "forwarder", "resolver"] }).notNull(),
    status: text("status", { enum: ["active", "invited"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("counterparties_pair").on(t.orgId, t.counterpartyOrgId, t.relationship)],
);

export const DEAL_STATUSES = [
  "draft",
  "awaiting_acceptance",
  "awaiting_funding",
  "funded",
  "completed",
  "cancelled",
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const deals = plimsoll.table(
  "deals",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    publicRef: text("public_ref").notNull().unique(),
    buyerOrgId: uuid("buyer_org_id").notNull().references(() => organizations.id),
    supplierOrgId: uuid("supplier_org_id").references(() => organizations.id),
    title: text("title").notNull(),
    status: text("status", { enum: DEAL_STATUSES }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    terms: jsonb("terms").$type<DealTerms>().notNull(),
    termsDigest: text("terms_digest"),
    dealIdHex: text("deal_id_hex"),
    chainNetwork: text("chain_network").notNull(),
    escrowContractId: text("escrow_contract_id").unique(),
    deployTxHash: text("deploy_tx_hash"),
    chainSnapshot: jsonb("chain_snapshot").$type<StoredSnapshot>(),
    chainSyncedLedger: integer("chain_synced_ledger"),
    chainSyncedAt: timestamp("chain_synced_at", { withTimezone: true }),
    chainSyncStatus: text("chain_sync_status", { enum: ["never", "ok", "unavailable"] }).notNull().default("never"),
    isSample: boolean("is_sample").notNull().default(false),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deals_buyer").on(t.buyerOrgId), index("deals_supplier").on(t.supplierOrgId)],
);

export const PARTICIPANT_ROLES = ["buyer", "supplier", "inspector", "forwarder", "resolver"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const dealParticipants = plimsoll.table(
  "deal_participants",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deals.id),
    orgId: uuid("org_id").references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id),
    role: text("role", { enum: PARTICIPANT_ROLES }).notNull(),
    displayName: text("display_name").notNull(),
    signingAddress: text("signing_address"),
    inviteEmail: text("invite_email"),
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    status: text("status", { enum: ["active", "invited"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [index("participants_deal").on(t.dealId), index("participants_user").on(t.userId)],
);

export const milestones = plimsoll.table(
  "milestones",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deals.id),
    ordinal: integer("ordinal").notNull(),
    name: text("name").notNull(),
    amountUnits: units("amount_units").notNull(),
    requiredDocuments: jsonb("required_documents").$type<string[]>().notNull().default([]),
  },
  (t) => [uniqueIndex("milestones_deal_ordinal").on(t.dealId, t.ordinal)],
);

export const shipments = plimsoll.table("shipments", {
  id: id(),
  dealId: uuid("deal_id").notNull().unique().references(() => deals.id),
  transportMode: text("transport_mode").notNull(),
  incoterm: text("incoterm").notNull(),
  namedPlace: text("named_place").notNull(),
  originPort: text("origin_port").notNull(),
  destinationPort: text("destination_port").notNull(),
  bookingRef: text("booking_ref"),
  carrierRef: text("carrier_ref"),
  vessel: text("vessel"),
  voyage: text("voyage"),
  stage: text("stage", { enum: ["booked", "at_origin", "handed_to_carrier", "in_transit", "arrived", "delivered"] }).notNull().default("booked"),
  etaAt: timestamp("eta_at", { withTimezone: true }),
  etaSource: text("eta_source"),
});

export const shipmentEvents = plimsoll.table("shipment_events", {
  id: id(),
  shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
  eventCode: text("event_code").notNull(),
  description: text("description").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  recordedAt: createdAt(),
  sourceType: text("source_type", { enum: ["manual", "carrier_api", "edi", "sample_fixture"] }).notNull(),
  sourceRef: text("source_ref"),
  recordedBy: uuid("recorded_by").references(() => users.id),
  isAttestation: boolean("is_attestation").notNull().default(false),
  signerAddress: text("signer_address"),
});

export const documents = plimsoll.table(
  "documents",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deals.id),
    documentType: text("document_type").notNull(),
    title: text("title").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("documents_deal").on(t.dealId)],
);

export const documentVersions = plimsoll.table(
  "document_versions",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => documents.id),
    version: integer("version").notNull(),
    objectKey: text("object_key").notNull(),
    sha256: text("sha256").notNull(),
    mediaType: text("media_type").notNull(),
    bytes: integer("bytes").notNull(),
    fileName: text("file_name").notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    uploadedAt: createdAt(),
    analysisState: text("analysis_state", { enum: ["queued", "processing", "done", "failed"] }).notNull().default("queued"),
    analysisError: text("analysis_error"),
    detectedType: text("detected_type"),
    typeConfidence: real("type_confidence"),
    pages: integer("pages"),
    extractorVersion: text("extractor_version"),
    modelUsed: text("model_used"),
  },
  (t) => [uniqueIndex("document_versions_doc_version").on(t.documentId, t.version)],
);

export const extractedFields = plimsoll.table("extracted_fields", {
  id: id(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  fieldKey: text("field_key").notNull(),
  value: text("value").notNull(),
  span: jsonb("span").$type<SourceSpan>().notNull(),
  confidence: real("confidence").notNull(),
  method: text("method", { enum: ["rule", "model"] }).notNull(),
});

export const extractedLineItems = plimsoll.table("extracted_line_items", {
  id: id(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  sku: text("sku").notNull(),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  uom: text("uom").notNull(),
  unitPrice: text("unit_price"),
  lineTotal: text("line_total"),
  grossWeightKg: text("gross_weight_kg"),
  span: jsonb("span").$type<SourceSpan>().notNull(),
  method: text("method", { enum: ["rule", "model"] }).notNull().default("rule"),
  confidence: real("confidence").notNull().default(1),
});

export const DISCREPANCY_STATES = ["open", "resolved", "accepted_as_is", "non_material", "correction_requested"] as const;

export const discrepancies = plimsoll.table(
  "discrepancies",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deals.id),
    fingerprint: text("fingerprint").notNull(),
    ruleId: text("rule_id").notNull(),
    field: text("field").notNull(),
    severity: text("severity", { enum: ["blocking", "warning", "info"] }).notNull(),
    confidence: real("confidence").notNull(),
    message: text("message").notNull(),
    expected: jsonb("expected").$type<FindingSide>().notNull(),
    actual: jsonb("actual").$type<FindingSide>().notNull(),
    state: text("state", { enum: DISCREPANCY_STATES }).notNull().default("open"),
    /** True while the latest reconciliation run still reports this finding. */
    active: boolean("active").notNull().default(true),
    resolutionReason: text("resolution_reason"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    explanation: text("explanation"),
    explanationModel: text("explanation_model"),
    firstSeenAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("discrepancies_deal_fingerprint").on(t.dealId, t.fingerprint)],
);

export const evidenceBundles = plimsoll.table(
  "evidence_bundles",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deals.id),
    milestoneOrdinal: integer("milestone_ordinal").notNull(),
    manifest: jsonb("manifest").$type<EvidenceManifest>().notNull(),
    digest: text("digest").notNull(),
    status: text("status", { enum: ["prepared", "anchored", "superseded"] }).notNull().default("prepared"),
    anchoredTxHash: text("anchored_tx_hash"),
    anchoredLedger: integer("anchored_ledger"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("bundles_deal_milestone").on(t.dealId, t.milestoneOrdinal)],
);

export const CHAIN_TX_KINDS = ["deploy", "accept", "fund", "anchor", "approve", "revoke", "release", "dispute", "resolve", "refund", "cancel", "ttl"] as const;
export type ChainTxKind = (typeof CHAIN_TX_KINDS)[number];

/** Every transaction Plimsoll submitted or attempted, reconciled against ledger results. */
export const chainTransactions = plimsoll.table(
  "chain_transactions",
  {
    id: id(),
    dealId: uuid("deal_id").notNull().references(() => deals.id),
    kind: text("kind", { enum: CHAIN_TX_KINDS }).notNull(),
    milestoneOrdinal: integer("milestone_ordinal"),
    actorAddress: text("actor_address").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    network: text("network").notNull(),
    txHash: text("tx_hash"),
    /** prepared → (signed and submitted) pending → confirmed | failed; expired if never signed. */
    status: text("status", { enum: ["prepared", "pending", "confirmed", "failed", "rejected_in_simulation", "expired"] }).notNull(),
    ledger: integer("ledger"),
    amountUnits: units("amount_units"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("chain_tx_network_hash").on(t.network, t.txHash), index("chain_tx_deal").on(t.dealId)],
);

export const chainEvents = plimsoll.table(
  "chain_events",
  {
    network: text("network").notNull(),
    eventId: text("event_id").notNull(),
    contractId: text("contract_id").notNull(),
    dealId: uuid("deal_id").references(() => deals.id),
    type: text("type").notNull(),
    milestoneOrdinal: integer("milestone_ordinal"),
    ledger: integer("ledger").notNull(),
    ledgerClosedAt: timestamp("ledger_closed_at", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.network, t.eventId] }), index("chain_events_deal").on(t.dealId)],
);

/** Last run of each periodic task, claimed atomically so concurrent schedulers never double-run. */
export const schedulerState = plimsoll.table("scheduler_state", {
  name: text("name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull(),
});

export const indexerCursors = plimsoll.table("indexer_cursors", {
  network: text("network").primaryKey(),
  lastLedger: integer("last_ledger").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputes = plimsoll.table("disputes", {
  id: id(),
  dealId: uuid("deal_id").notNull().references(() => deals.id),
  milestoneOrdinal: integer("milestone_ordinal").notNull(),
  reason: text("reason").notNull(),
  reasonDigest: text("reason_digest").notNull(),
  openedByAddress: text("opened_by_address").notNull(),
  openedByUserId: uuid("opened_by_user_id").references(() => users.id),
  resolverAddress: text("resolver_address").notNull(),
  status: text("status", { enum: ["opening", "open", "resolved"] }).notNull(),
  resolution: jsonb("resolution").$type<{ toBuyer: string; toPayee: string; rationale: string }>(),
  openTxHash: text("open_tx_hash"),
  resolutionTxHash: text("resolution_tx_hash"),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const disputeStatements = plimsoll.table("dispute_statements", {
  id: id(),
  disputeId: uuid("dispute_id").notNull().references(() => disputes.id),
  authorUserId: uuid("author_user_id").notNull().references(() => users.id),
  authorRole: text("author_role").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/** Append-only; each row hashes its predecessor so tampering breaks the chain. */
export const auditEvents = plimsoll.table(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id"),
    dealId: uuid("deal_id"),
    actorUserId: uuid("actor_user_id"),
    actorLabel: text("actor_label").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome", { enum: ["success", "denied", "failed"] }).notNull(),
    source: text("source", { enum: ["app", "chain", "system"] }).notNull().default("app"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_deal").on(t.dealId), index("audit_org").on(t.orgId)],
);

export const notifications = plimsoll.table(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    dealId: uuid("deal_id").references(() => deals.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user").on(t.userId)],
);

export const jobs = plimsoll.table(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key").unique(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    deadAt: timestamp("dead_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_ready").on(t.runAt)],
);

export const webhookEndpoints = plimsoll.table("webhook_endpoints", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const webhookDeliveries = plimsoll.table("webhook_deliveries", {
  id: id(),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["pending", "delivered", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  responseCode: integer("response_code"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const apiKeys = plimsoll.table("api_keys", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const idempotencyKeys = plimsoll.table(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] })],
);

/** Delivery record for every outgoing email. Bodies are never stored: they can carry single-use tokens. */
export const emailOutbox = plimsoll.table(
  "email_outbox",
  {
    id: id(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    tag: text("tag").notNull(),
    transport: text("transport", { enum: ["log", "cloudflare"] }).notNull(),
    status: text("status", { enum: ["sending", "sent", "logged", "bounced", "failed"] }).notNull().default("sending"),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("email_outbox_created").on(t.createdAt)],
);
