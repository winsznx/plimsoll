import { ArrowLeft, ClockCounterClockwise, FileText, SealCheck } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { Chip, DealStatusChip } from "@/components/chip";
import { Hash } from "@/components/hash";
import { ageLabel } from "@/components/workspace/age";
import { dealViews } from "@/components/workspace/deal-views";
import { CarrierFeedControl } from "@/components/workspace/carrier-feed-control";
import { JourneyLegend, JourneyLine } from "@/components/workspace/journey-line";
import { ShipmentEventForm } from "@/components/workspace/shipment-event-form";
import { fmtDateTime, shortAddress } from "@/lib/format";
import type { DealView, ShipmentView } from "@/lib/views";
import { requireSession } from "@/server/auth/guard";
import { providerOfSourceRef } from "@/server/carriers/registry";
import { explorer } from "@/server/chain";
import { db, schema } from "@/server/db/client";
import { carrierFeed, carrierProviderOptions, type CarrierFeedView } from "@/server/services/carriers";
import { shipmentFor, STAGE_FOR, STAGE_ORDER } from "@/server/services/shipments";
import styles from "./shipments.module.css";

export const metadata: Metadata = { title: "Shipments" };

const RECORDING_ROLES = ["buyer", "supplier", "forwarder", "inspector"];

function sourceLabel(source: string): string {
  return source.replaceAll("_", " ");
}

async function recorderNames(dealId: string): Promise<Map<string, string>> {
  const shipment = await shipmentFor(dealId);
  const events = shipment?.events ?? [];
  const ids = [...new Set(events.map((e) => e.recordedBy).filter((id): id is string => id !== null))];
  const users = ids.length ? await db().select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const byUser = new Map(users.map((u) => [u.id, u.displayName]));
  return new Map(events.map((e) => [e.id, (e.recordedBy ? byUser.get(e.recordedBy) : null) ?? "System import"]));
}

function blockedReasons(deal: DealView): { record: string | null; attest: string | null } {
  const roles = deal.myRoles;
  const record = roles.some((r) => RECORDING_ROLES.includes(r)) ? null : `Buyer, supplier, forwarder or inspector records events. You are ${roles.join(", ")} on ${deal.reference}.`;
  const attestRole = roles.find((r) => r === "forwarder" || r === "inspector");
  if (!attestRole) return { record, attest: `Only the appointed forwarder or inspector attests. You are ${roles.join(", ")} on ${deal.reference}.` };
  const signer = deal.participants.find((p) => p.role === attestRole && p.address && deal.myAddresses.includes(p.address));
  return { record, attest: signer ? null : `Attest from your appointed ${attestRole} address. Link that wallet in Settings.` };
}

function feedBlockedReason(deal: DealView): string | null {
  if (deal.status === "completed" || deal.status === "cancelled") return `${deal.reference} is closed. Its feed is fixed.`;
  if (deal.myRoles.some((r) => r === "buyer" || r === "forwarder")) return null;
  return `Only the buyer or forwarder picks the feed. You are ${deal.myRoles.join(", ")} on ${deal.reference}.`;
}

function feedPollStatus(deal: DealView, feed: CarrierFeedView, now: number): React.ReactNode {
  if (feed.lastPolledAt) {
    return (
      <span className="mono tiny">
        {fmtDateTime(feed.lastPolledAt)} · {ageLabel(feed.lastPolledAt, now)}
      </span>
    );
  }
  if (!feed.provider) return <span className="faint">No feed attached</span>;
  if (deal.status !== "funded" || !feed.fundedAt) return <span className="faint">Starts once funding confirms on the ledger</span>;
  return <span className="faint">Not yet. Polled every 5 minutes.</span>;
}

/** Imported events name their feed; a manually typed reference never resolves to one. */
function feedLabel(e: ShipmentView["events"][number]): string | null {
  const provider = providerOfSourceRef(e.sourceRef);
  return provider && provider.sourceType === e.sourceType ? provider.label : null;
}

function LatestEvent({ shipment, now }: { shipment: ShipmentView; now: number }) {
  const e = shipment.events[0];
  if (!e) return <span className="faint small">No events recorded</span>;
  return (
    <div className={styles.latest}>
      <span className={styles.eventLine}>
        <i className={e.isAttestation ? styles.markAttested : styles.markContext} aria-label={e.isAttestation ? "Attested" : "Context"} role="img" />
        <span className="mono tiny">{e.eventCode}</span>
      </span>
      <span className={`small ${styles.clamp}`}>{e.description}</span>
      <span className="row wrap" style={{ gap: 8 }}>
        <Chip tone="neutral">{sourceLabel(e.sourceType)}</Chip>
        <span className="tiny faint mono">{ageLabel(e.occurredAt, now)}</span>
      </span>
    </div>
  );
}

function vesselOf(s: ShipmentView): string | null {
  return s.vessel ? `${s.vessel}${s.voyage ? ` ${s.voyage}` : ""}` : null;
}

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ deal?: string }> }) {
  const { deal: focusId } = await searchParams;
  const session = await requireSession();
  const deals = await dealViews(session);
  const now = Date.now();

  if (focusId) {
    const focus = deals.find((d) => d.id === focusId);
    if (!focus) notFound();
    return <FocusedShipment deal={focus} now={now} />;
  }

  const withShipment = deals.filter((d): d is DealView & { shipment: ShipmentView } => d.shipment !== null);
  const without = deals.filter((d) => d.shipment === null);
  const moving = withShipment.filter((d) => d.shipment.stage !== "booked" && d.shipment.stage !== "delivered").length;

  return (
    <>
      {deals.some((d) => d.isSample) ? <p className="sample-banner">Includes sample deals · synthetic carrier events · real testnet transactions</p> : null}
      <div className="page-head">
        <div>
          <h1>Shipments</h1>
          <div className="sub">
            <span className="mono">
              {withShipment.length} shipment{withShipment.length === 1 ? "" : "s"} · {moving} moving
            </span>
            <span>Events are context for approvers. They never release funds.</span>
          </div>
        </div>
        <JourneyLegend />
      </div>

      <section className="panel" aria-label="Shipments by deal">
        {withShipment.length === 0 ? (
          <p className="empty">
            <strong>No shipments yet</strong>
            Each deal draft opens a shipment record. <Link className="ext" href="/deals/new">Create a deal</Link>
          </p>
        ) : (
          <>
            <div className={styles.listHead} aria-hidden="true">
              <span>Deal</span>
              <span>Journey</span>
              <span>Latest event</span>
            </div>
            <ul className={styles.list}>
              {withShipment.map((d) => {
                const s = d.shipment;
                const vessel = vesselOf(s);
                return (
                  <li key={d.id} className={styles.row}>
                    <div className={styles.rowDeal}>
                      <Link className="ext mono" href={`/shipments?deal=${d.id}`}>
                        {d.reference}
                      </Link>
                      <span className={`small ${styles.clamp}`}>{d.title}</span>
                      <DealStatusChip status={d.status} />
                    </div>
                    <div className={styles.rowJourney}>
                      <JourneyLine shipment={s} stages={STAGE_ORDER} stageOf={STAGE_FOR} />
                      <p className={styles.meta}>
                        <span style={{ textTransform: "capitalize" }}>{s.transportMode}</span>
                        <span>
                          {s.incoterm} {s.namedPlace}
                        </span>
                        <span>{vessel ?? <span className="faint">No vessel</span>}</span>
                        {s.carrierRef ? <span>{s.carrierRef}</span> : null}
                      </p>
                    </div>
                    <div className={styles.rowLatest}>
                      <LatestEvent shipment={s} now={now} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {without.length > 0 ? <p className="tiny faint" style={{ marginTop: 12 }}>No shipment record on {without.map((d) => d.reference).join(", ")}.</p> : null}
    </>
  );
}

async function FocusedShipment({ deal, now }: { deal: DealView; now: number }) {
  const s = deal.shipment;
  const recorders = s ? await recorderNames(deal.id) : new Map<string, string>();
  const blocked = blockedReasons(deal);
  const feed = s ? await carrierFeed(deal.id) : null;
  const attested = s ? s.events.filter((e) => e.isAttestation).length : 0;

  return (
    <>
      {deal.isSample ? <p className="sample-banner">Sample deal · synthetic carrier events · real {deal.network.label} transactions</p> : null}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            <Link href="/shipments">Shipments</Link> · {deal.terms.poNumber}
          </p>
          <h1 style={{ marginTop: 6 }}>{deal.reference} shipment</h1>
          <div className="sub">
            <DealStatusChip status={deal.status} />
            <span>{deal.title}</span>
            <span className="tiny faint">You: {deal.myRoles.join(", ")}</span>
          </div>
        </div>
        <nav className="btn-group" aria-label="Shipment views">
          <Link className="btn" href={`/deals/${deal.id}#shipment`}>
            <FileText aria-hidden />
            Open agreement
          </Link>
          <Link className="btn" href={`/activity?deal=${deal.id}`}>
            <ClockCounterClockwise aria-hidden />
            Audit trail
          </Link>
        </nav>
      </div>

      {!s ? (
        <div className="panel">
          <p className="empty">
            <strong>No shipment record</strong>
            Records open from the agreement&apos;s delivery terms.
          </p>
          <div style={{ padding: "0 20px 20px", textAlign: "center" }}>
            <Link className="ext small" href="/shipments">
              <ArrowLeft aria-hidden style={{ width: 12, height: 12, verticalAlign: -1 }} /> All shipments
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className={styles.hero} aria-label="Journey">
            <div className={styles.heroTop}>
              <Chip tone={s.stage === "delivered" ? "confirmed" : "awaiting"}>{s.stage.replaceAll("_", " ")}</Chip>
              <JourneyLegend />
            </div>
            <JourneyLine shipment={s} stages={STAGE_ORDER} stageOf={STAGE_FOR} size="lg" />
            <dl className={styles.stats}>
              <div>
                <dt>Mode</dt>
                <dd style={{ textTransform: "capitalize" }}>{s.transportMode}</dd>
              </div>
              <div>
                <dt>Incoterm</dt>
                <dd className="mono">
                  {s.incoterm} {s.namedPlace} · {deal.terms.goods.incoterm.edition}
                </dd>
              </div>
              <div>
                <dt>Vessel / voyage</dt>
                <dd>{vesselOf(s) ?? <span className="faint">Not assigned</span>}</dd>
              </div>
              <div>
                <dt>Carrier ref</dt>
                <dd className="mono">{s.carrierRef ?? <span className="faint">None</span>}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd className="mono">
                  {s.events.length} <span className="faint">· {attested} attested</span>
                </dd>
              </div>
            </dl>
            <p className={styles.heroNote}>
              <SealCheck weight="fill" aria-hidden />
              Events are context. Only approver signatures on the anchored evidence release funds.
            </p>
          </section>

          <article className="panel" aria-labelledby="events-h" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <h2 id="events-h" style={{ fontSize: 15 }}>
                Transport events
              </h2>
              <span className="tiny faint mono">Newest first</span>
            </div>
            <div className={`panel-body flush table-scroll ${styles.scroller}`}>
              {s.events.length === 0 ? (
                <p className="empty">
                  <strong>No events yet</strong>
                  Record the first one below.
                </p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Occurred</th>
                      <th>Recorded</th>
                      <th>Source</th>
                      <th>Attestation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.events.map((e) => (
                      <tr key={e.id}>
                        <td style={{ minWidth: 220 }}>
                          <span className={styles.eventLine}>
                            <i className={e.isAttestation ? styles.markAttested : styles.markContext} aria-hidden="true" />
                            <span className="mono tiny">{e.eventCode}</span>
                          </span>
                          <div className="small">{e.description}</div>
                        </td>
                        <td className="mono tiny" style={{ whiteSpace: "nowrap" }}>
                          {fmtDateTime(e.occurredAt)}
                          <div className="faint">{ageLabel(e.occurredAt, now)}</div>
                        </td>
                        <td className="small">
                          {recorders.get(e.id) ?? "Unknown user"}
                          <div className="mono tiny faint">{fmtDateTime(e.recordedAt)}</div>
                        </td>
                        <td>
                          <Chip tone="neutral">{sourceLabel(e.sourceType)}</Chip>
                          {feedLabel(e) ? <div className="tiny muted" style={{ marginTop: 4 }}>{feedLabel(e)}</div> : null}
                          {e.sourceRef ? <div className="tiny faint mono" style={{ marginTop: 4 }}>{e.sourceRef}</div> : null}
                        </td>
                        <td className="small">
                          {e.isAttestation && e.signerAddress ? (
                            <>
                              Signed by {e.signerName ?? shortAddress(e.signerAddress)}
                              <div>
                                <Hash value={e.signerAddress} href={explorer("account", e.signerAddress)} label="attestation signer" />
                              </div>
                            </>
                          ) : (
                            <span className="faint">Context</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </article>

          <div className="grid-2">
            <div className="stack">
              <article className="panel" aria-labelledby="record-h">
                <div className="panel-head">
                  <div>
                    <h2 id="record-h" style={{ fontSize: 15 }}>
                      Record an event
                    </h2>
                    <p className="sub">Dated, sourced, and written to the audit trail.</p>
                  </div>
                </div>
                <div className="panel-body">
                  <ShipmentEventForm dealId={deal.id} reference={deal.reference} recordBlocked={blocked.record} attestBlocked={blocked.attest} />
                </div>
              </article>
            </div>

            <aside className="stack" aria-label="Carrier feed">
              {feed ? (
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h2 style={{ fontSize: 15 }}>Carrier feed</h2>
                      <p className="sub">Read every 5 minutes while funded.</p>
                    </div>
                    <Chip tone={feed.provider ? "awaiting" : "neutral"}>{feed.provider ? "attached" : "manual only"}</Chip>
                  </div>
                  <div className="panel-body">
                    <dl className="kv">
                      <dt>Source</dt>
                      <dd>{feed.provider ? feed.provider.label : <span className="faint">None. Manual entry only.</span>}</dd>
                      {feed.provider ? (
                        <>
                          <dt>Type</dt>
                          <dd className="mono tiny">{sourceLabel(feed.provider.sourceType)}</dd>
                          <dt>Confidence</dt>
                          <dd className="small">{feed.provider.confidence}</dd>
                        </>
                      ) : null}
                      <dt>Last polled</dt>
                      <dd className="small">{feedPollStatus(deal, feed, now)}</dd>
                      <dt>Reported ETA</dt>
                      <dd className="small">{feed.etaAt ? <span className="mono tiny">{fmtDateTime(feed.etaAt)}</span> : <span className="faint">None</span>}</dd>
                    </dl>
                    <CarrierFeedControl dealId={deal.id} reference={deal.reference} attached={feed.provider ? { id: feed.provider.id, label: feed.provider.label } : null} options={carrierProviderOptions()} blocked={feedBlockedReason(deal)} />
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
