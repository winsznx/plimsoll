# Plimsoll

**[Live demo](https://plimsoll-omega.vercel.app)** · **[Video (2:31)](https://youtu.be/uQZe5YYR1PQ)** · **[Public proof for a live deal](https://plimsoll-omega.vercel.app/verify/_5KVFzCbwyS3)** · [Escrow contract on stellar.expert](https://stellar.expert/explorer/testnet/contract/CBD67OA7J66B56PDTG367GK3HSR3LSU6UE364CHC3C62PNJZMC77MNNM)

Trade agreements that know when to pay. A buyer and supplier agree on milestone payments, documents are reconciled against the terms, appointed parties approve the exact evidence they reviewed, and a per-deal Soroban escrow on Stellar releases each tranche only when its conditions hold on-chain.

This repository is a working testnet product: a Rust escrow contract, a Next.js workspace with its API and background worker, and scripts that prove the money paths against the live Stellar testnet. It settles in `DEMOUSD`, a demo token issued by the bootstrap script. It is not USDC, not audited, and not a bank or legal-title product.

## Run it

Requirements: Node 22+, pnpm 11, Rust with the `wasm32v1-none` target, and the `stellar` CLI.

```bash
pnpm install
pnpm bootstrap:testnet   # builds the contract, funds accounts via friendbot, issues DEMOUSD,
                         # deploys its Stellar Asset Contract, uploads the escrow wasm,
                         # writes apps/web/.env.local
pnpm dev                 # http://localhost:3000 with an embedded Postgres (PGlite)
```

On first boot the worker seeds five demo personas and two sample deals with real testnet transactions (about two minutes). Open `/sign-in` and pick a persona. No wallet extension is needed for demo personas; they sign with testnet-only custody keys held by the deployment, and every surface says so. Real users register with a passkey and link Freighter.

Dev data (PGlite files and uploaded originals) lives in `.data/` at the repo root; delete it to reseed from scratch. Set `DATABASE_URL` to use an external Postgres instead of PGlite. `ANTHROPIC_API_KEY` is optional. It adds plain-language explanations to findings and lets a model read scanned or unreadable documents (`pnpm fixtures:scanned` builds an image-only packing list to try it).

## Keys and configuration

Nothing needs to be supplied for testnet. `pnpm bootstrap:testnet` generates and friendbot-funds every key it needs (relayer, demo issuer, five demo personas) and writes them to `apps/web/.env.local`, which is git-ignored. See `apps/web/.env.example` for every variable.

| Key | Needed for | Source |
|---|---|---|
| `PLIMSOLL_RELAYER_SECRET` | Pays fees, deploys escrows. Has no authority over escrow funds | bootstrap |
| `PLIMSOLL_ISSUER_SECRET` | Demo token faucet (testnet only) | bootstrap |
| `DEMO_*_SECRET` | Demo personas' testnet custody keys | bootstrap |
| `ANTHROPIC_API_KEY` | Optional: plain-language explanations of findings, model-assisted extraction of scans | you |
| `DATABASE_URL` | Optional: external Postgres instead of embedded PGlite | you |

To settle in Circle's testnet USDC instead of the demo token, set `PLIMSOLL_ASSET_CODE=USDC`, `PLIMSOLL_ASSET_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, `PLIMSOLL_ASSET_IS_DEMO=false`, and `PLIMSOLL_TOKEN_CONTRACT_ID` to the output of `stellar contract id asset --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet`. Buyer and payee accounts then need a USDC trustline and funds from https://faucet.circle.com; the in-app faucet is disabled for real assets.

Testnet is reset a few times a year (the next scheduled reset is 16 December 2026). A reset deletes the uploaded escrow code, the asset contract and every deal escrow. `/api/v1/health/ready` reports it under `deployment`; recover with `pnpm bootstrap:testnet`, then delete `.data/` and restart to reseed.

## Deploy

The live testnet deployment is https://plimsoll-omega.vercel.app: the app on Vercel, Postgres and document storage on Supabase, and a Cloudflare Worker cron that drives background work.

- **Database.** `DATABASE_URL` is Supabase's transaction pooler (port 6543). Supabase signs its pooler certificate with its own root CA, so `sslmode=require` fails Node's trust store. Put the PEM of "Supabase Root 2021 CA" in `DATABASE_CA_CERT` and leave `sslmode` out of the URL; connections then verify the server. Migrations apply on first use. All tables live in the `plimsoll` schema, which Supabase's REST API does not expose.
- **Documents.** `OBJECT_STORE=s3` with Supabase Storage's S3 endpoint (`https://<ref>.storage.supabase.co/storage/v1/s3`), a private bucket, `S3_REGION` set to the project region, and session auth: `S3_ACCESS_KEY_ID` = project ref, `S3_SECRET_ACCESS_KEY` = anon key, `S3_SESSION_TOKEN` = service-role key. Any S3-compatible store (R2) works with plain access keys instead.
- **App.** Deploy the repo root with the Vercel CLI (`vercel deploy --prod`); the project's root directory is `apps/web`. `.vercelignore` keeps every `.env*` file and local data out of the upload, so set production values with `vercel env add`. Set `RUN_WORKERS=false`, a random `CRON_SECRET`, and `PLIMSOLL_ORIGIN` to the production URL (passkeys bind to its hostname).
- **Background work.** `infra/scheduler` is a Worker whose cron calls `POST /api/internal/tick` every minute with `CRON_SECRET`. Set `APP_URL` in its `wrangler.jsonc`, run `npx wrangler deploy`, then `npx wrangler secret put CRON_SECRET`. The first ticks seed the demo deals on testnet.

## Prove it

| Command | What it checks |
|---|---|
| `pnpm test:contract` | 27 Soroban unit tests: every negative case in the lifecycle spec (wrong token, stale digest, missing quorum, replay, dispute freeze, over-allocation, no admin override, TTL survival) plus conservation after each path |
| `pnpm -r test` | 97 TypeScript tests: integer money, canonical digests, reconciliation rules, milestone gating, PDF extraction against the fixture documents, the relayer's sponsorship guard, and ABI conformance (every argument and decoded struct checked byte for byte against the contract spec exported from the wasm) |
| `pnpm contract:spec:check` | The committed contract spec in `packages/stellar/src/generated/` matches the built wasm, so client encoding cannot drift from the contract. CI runs it |
| `pnpm verify:chain` | Deploys a fresh escrow on testnet and runs 20 positive and negative trials, asserting only from ledger readback and token balance deltas. Writes `evidence/verify-*.json` |
| `pnpm e2e` | With `pnpm dev` running: 28 steps through the HTTP API as five separately signed-in personas, covering creation, acceptance, funding, a document mismatch, a corrected version, contract-rejected releases, quorum release, replay, dispute and resolver split. Writes `evidence/e2e-*.json` |

Receipts from runs made while building this are in [`evidence/`](evidence/), each with testnet transaction hashes you can open on stellar.expert.

## Browser tests

Playwright specs in `tests/e2e/` drive the running app in Chrome at 1440×900 and 375×812, each in light and dark. They use the locally installed Google Chrome when there is one; otherwise run `pnpm --filter @plimsoll/e2e exec playwright install chromium` once. Start `pnpm dev` first and wait for the demo seed to finish (PL-2048 and PL-2049 exist).

| Command | What it runs |
|---|---|
| `pnpm e2e:browser` | Read-only suites. `public`: landing replay and proof strip, `/verify` with in-browser digest recomputation, the 404 page. `persona-journeys`: sign in through the persona cards, follow PL-2048 from the overview to the cockpit's "why not yet", the R-QTY highlight in the document comparison and the confirmed settlement; the PL-2049 resolver form and the buyer's view of it. `a11y`: axe (WCAG 2.0/2.1/2.2 A and AA) on every public and core workspace page, plus a check that no page scrolls sideways |
| `pnpm e2e:browser:full` | Everything above plus `full-scenario`: creates a new deal through the seven-step wizard, freezes and accepts terms as buyer and supplier, funds, uploads the documents, sees the 148 vs 160 mismatch, uploads the corrected packing list, anchors evidence, approves as inspector and buyer, releases, and checks the ledger-confirmed payout. It writes to testnet (about 10 transactions) and takes several minutes |

The read-only suites never sign, upload or record a decision, so they are safe to run against the seeded demo. Point them at another deployment with `PLIMSOLL_URL=https://…`. Pass Playwright flags after the script, e.g. `pnpm e2e:browser --project=mobile-dark` or `pnpm e2e:browser:full specs/full-scenario.spec.ts --project=desktop-light`. Failures keep a trace and screenshot in `tests/e2e/test-results/`; open the report with `pnpm --filter @plimsoll/e2e exec playwright show-report`.

## The demo scenario

`PL-2048` is a funded 148,600 DEMOUSD tile order, Ningbo to Felixstowe, FOB Ningbo, split 20/60/20:

1. The deposit tranche is already released on-chain.
2. The supplier's packing list says 148 cartons of `KC-TILE-30`; the invoice and terms say 160. The rule engine blocks the carrier-handoff tranche.
3. Attempting release now is rejected by the contract, and the rejection is recorded.
4. As the supplier, upload `tests/fixtures/packing-list-v2-corrected.pdf` as a new version. The finding clears; version 1 stays in history.
5. Prepare and anchor the evidence bundle, approve as the inspector and the buyer, release. The payout and ledger number come from the chain.

`PL-2049` has its receipt tranche frozen by a buyer dispute. Sign in as the resolver to split it.

## Screens

Public: landing with the recorded testnet session (`/`), public proof with in-browser hash checking (`/verify/<ref>`), supplier invitations (`/invite/<token>`), sign-in with demo personas or passkeys.

Workspace: overview, deals index with CSV export, seven-step deal wizard, the agreement cockpit (timeline, milestone cards with "why not yet" gating, settlement rail), document comparison (paper replicas with source highlighting, findings, reviewer decisions, versioned uploads), settlement detail, dispute case with resolver split, shipments with attestations, cross-deal documents and settlements, counterparties, audit activity with hash-chain verification, notifications, and settings (Freighter linking, trustline, demo faucet, signed webhooks, API keys).

API: `/api/v1`, cookie sessions or `Authorization: Bearer <api key>`, typed errors, `Idempotency-Key` on mutations. Health at `/api/v1/health/live` and `/api/v1/health/ready`.

## How it fits together

```
contracts/trade-escrow     Soroban escrow, one immutable instance per deal (no admin, no upgrade, no sweep)
packages/domain            integer money, canonical terms/evidence digests, reconciliation rules, milestone gating
packages/stellar           RPC gateway: simulate → assemble → sign → fee-bump → poll; ledger readback; events
packages/documents         PDF line extraction with source boxes, field/table parsing, fixture renderer
apps/web                   Next.js workspace, /api/v1, Postgres schema, worker (jobs, indexer, webhooks)
scripts/                   bootstrap, chain verification, API end-to-end, dev launcher
```

The contract's interface is its spec, embedded in the wasm. `pnpm build:contract` exports it to `packages/stellar/src/generated/trade-escrow.spec.json`; the client's hand-written encoders are tested against it rather than trusted.

Money state is read from the ledger, never from the database. After every submission the server reads the escrow's ledger entries and the token balance directly and stores that snapshot; the UI renders only that. If RPC is down the UI says the status is unavailable rather than guessing.

Each signed action is prepared server-side, shown to the signer as a list of on-chain consequences, signed (Freighter or demo custody), then wrapped in a relayer fee bump. The relayer only sponsors fees: it refuses anything other than the single expected call to the deal's own contract, signed by the expected participant, and it has no authority over escrow funds. Release and timed refunds are permissionless on-chain because the contract checks every predicate itself.

Documents are stored content-addressed and write-once. Extraction keeps the page and box of every value so findings point at their source. Severity comes from deterministic rules. The optional model writes explanations and, when a document has no text layer or the rules find fewer than half of its required fields, fills only the missing fields: each carries a quoted source line and page, has no box on the page, is capped at 0.85 confidence and is labelled "model-extracted, verify against source". Rule matches are never overwritten. An evidence bundle is a canonical manifest of document hashes and versions, reviewed findings and attestations, hashed with domain separation; approvals are bound on-chain to that digest, so re-anchoring changed evidence voids earlier approvals.

## Limits

Testnet only. The contract has not been audited. `DEMOUSD` is not USDC. Organizations are unverified unless verified by a real KYB process, which is not implemented. Hashes prove which document versions were reviewed, not that documents are genuine or that goods moved. Carrier events are labelled context; only appointed approvers' on-chain signatures count. Email (verification, invitations, notifications) goes through Cloudflare Email Service once a sending domain is onboarded; until then it is logged, not sent.

## License

[MIT](LICENSE)
