CREATE SCHEMA "plimsoll";
--> statement-breakpoint
CREATE TABLE "plimsoll"."api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"deal_id" uuid,
	"actor_user_id" uuid,
	"actor_label" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid,
	"pending_email" text,
	"pending_name" text,
	"pending_org" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_challenges_challenge_unique" UNIQUE("challenge")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."chain_events" (
	"network" text NOT NULL,
	"event_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"deal_id" uuid,
	"type" text NOT NULL,
	"milestone_ordinal" integer,
	"ledger" integer NOT NULL,
	"ledger_closed_at" timestamp with time zone NOT NULL,
	"tx_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "chain_events_network_event_id_pk" PRIMARY KEY("network","event_id")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."chain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"milestone_ordinal" integer,
	"actor_address" text NOT NULL,
	"actor_user_id" uuid,
	"network" text NOT NULL,
	"tx_hash" text,
	"status" text NOT NULL,
	"ledger" integer,
	"amount_units" bigint,
	"error_code" text,
	"error_detail" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."counterparties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"counterparty_org_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."deal_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"signing_address" text,
	"invite_email" text,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"public_ref" text NOT NULL,
	"buyer_org_id" uuid NOT NULL,
	"supplier_org_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"terms" jsonb NOT NULL,
	"terms_digest" text,
	"deal_id_hex" text,
	"chain_network" text NOT NULL,
	"escrow_contract_id" text,
	"deploy_tx_hash" text,
	"chain_snapshot" jsonb,
	"chain_synced_ledger" integer,
	"chain_synced_at" timestamp with time zone,
	"chain_sync_status" text DEFAULT 'never' NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_reference_unique" UNIQUE("reference"),
	CONSTRAINT "deals_public_ref_unique" UNIQUE("public_ref"),
	CONSTRAINT "deals_escrow_contract_id_unique" UNIQUE("escrow_contract_id")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"rule_id" text NOT NULL,
	"field" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" real NOT NULL,
	"message" text NOT NULL,
	"expected" jsonb NOT NULL,
	"actual" jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"resolution_reason" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"explanation" text,
	"explanation_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."dispute_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"milestone_ordinal" integer NOT NULL,
	"reason" text NOT NULL,
	"reason_digest" text NOT NULL,
	"opened_by_address" text NOT NULL,
	"opened_by_user_id" uuid,
	"resolver_address" text NOT NULL,
	"status" text NOT NULL,
	"resolution" jsonb,
	"open_tx_hash" text,
	"resolution_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"media_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analysis_state" text DEFAULT 'queued' NOT NULL,
	"analysis_error" text,
	"detected_type" text,
	"type_confidence" real,
	"pages" integer,
	"extractor_version" text,
	"model_used" text
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."evidence_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"milestone_ordinal" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"digest" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"anchored_tx_hash" text,
	"anchored_ledger" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" text NOT NULL,
	"span" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"method" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."extracted_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"uom" text NOT NULL,
	"unit_price" text,
	"line_total" text,
	"gross_weight_kg" text,
	"span" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."indexer_cursors" (
	"network" text PRIMARY KEY NOT NULL,
	"last_ledger" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"done_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"deal_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."scheduler_state" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_org_id" uuid,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"event_code" text NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"recorded_by" uuid,
	"is_attestation" boolean DEFAULT false NOT NULL,
	"signer_address" text
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"transport_mode" text NOT NULL,
	"incoterm" text NOT NULL,
	"named_place" text NOT NULL,
	"origin_port" text NOT NULL,
	"destination_port" text NOT NULL,
	"booking_ref" text,
	"carrier_ref" text,
	"vessel" text,
	"voyage" text,
	"stage" text DEFAULT 'booked' NOT NULL,
	"eta_at" timestamp with time zone,
	"eta_source" text,
	CONSTRAINT "shipments_deal_id_unique" UNIQUE("deal_id")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"network" text NOT NULL,
	"account_kind" text NOT NULL,
	"label" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plimsoll"."webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plimsoll"."api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."chain_events" ADD CONSTRAINT "chain_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."chain_transactions" ADD CONSTRAINT "chain_transactions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."chain_transactions" ADD CONSTRAINT "chain_transactions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."counterparties" ADD CONSTRAINT "counterparties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."counterparties" ADD CONSTRAINT "counterparties_counterparty_org_id_organizations_id_fk" FOREIGN KEY ("counterparty_org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."deal_participants" ADD CONSTRAINT "deal_participants_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."deal_participants" ADD CONSTRAINT "deal_participants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."deal_participants" ADD CONSTRAINT "deal_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."deals" ADD CONSTRAINT "deals_buyer_org_id_organizations_id_fk" FOREIGN KEY ("buyer_org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."deals" ADD CONSTRAINT "deals_supplier_org_id_organizations_id_fk" FOREIGN KEY ("supplier_org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."discrepancies" ADD CONSTRAINT "discrepancies_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."discrepancies" ADD CONSTRAINT "discrepancies_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."dispute_statements" ADD CONSTRAINT "dispute_statements_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "plimsoll"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."dispute_statements" ADD CONSTRAINT "dispute_statements_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."disputes" ADD CONSTRAINT "disputes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."disputes" ADD CONSTRAINT "disputes_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "plimsoll"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."evidence_bundles" ADD CONSTRAINT "evidence_bundles_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."evidence_bundles" ADD CONSTRAINT "evidence_bundles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."extracted_fields" ADD CONSTRAINT "extracted_fields_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "plimsoll"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."extracted_line_items" ADD CONSTRAINT "extracted_line_items_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "plimsoll"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."milestones" ADD CONSTRAINT "milestones_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."notifications" ADD CONSTRAINT "notifications_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."sessions" ADD CONSTRAINT "sessions_active_org_id_organizations_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "plimsoll"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."shipment_events" ADD CONSTRAINT "shipment_events_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."shipments" ADD CONSTRAINT "shipments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "plimsoll"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "plimsoll"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "plimsoll"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plimsoll"."webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "plimsoll"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_deal" ON "plimsoll"."audit_events" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "audit_org" ON "plimsoll"."audit_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "chain_events_deal" ON "plimsoll"."chain_events" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_tx_network_hash" ON "plimsoll"."chain_transactions" USING btree ("network","tx_hash");--> statement-breakpoint
CREATE INDEX "chain_tx_deal" ON "plimsoll"."chain_transactions" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "counterparties_pair" ON "plimsoll"."counterparties" USING btree ("org_id","counterparty_org_id","relationship");--> statement-breakpoint
CREATE INDEX "participants_deal" ON "plimsoll"."deal_participants" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "participants_user" ON "plimsoll"."deal_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deals_buyer" ON "plimsoll"."deals" USING btree ("buyer_org_id");--> statement-breakpoint
CREATE INDEX "deals_supplier" ON "plimsoll"."deals" USING btree ("supplier_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discrepancies_deal_fingerprint" ON "plimsoll"."discrepancies" USING btree ("deal_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version" ON "plimsoll"."document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "documents_deal" ON "plimsoll"."documents" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "bundles_deal_milestone" ON "plimsoll"."evidence_bundles" USING btree ("deal_id","milestone_ordinal");--> statement-breakpoint
CREATE INDEX "jobs_ready" ON "plimsoll"."jobs" USING btree ("run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user" ON "plimsoll"."memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_deal_ordinal" ON "plimsoll"."milestones" USING btree ("deal_id","ordinal");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "plimsoll"."notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address_network" ON "plimsoll"."wallets" USING btree ("address","network");