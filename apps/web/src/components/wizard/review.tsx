import { PencilSimple } from "@phosphor-icons/react";
import { Figure } from "@/components/instruments/figure";
import { shortAddress, units } from "@/lib/format";
import { DOCUMENT_TYPE_LABELS, bpsLabel, effectiveAmounts, goodsTotal, lineTotal, safeUnits, type WizardContext, type WizardState } from "./model";
import styles from "./wizard.module.css";

function Block({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <h3>{title}</h3>
        <button type="button" className="btn ghost sm" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          <PencilSimple aria-hidden />
          Edit
        </button>
      </div>
      {children}
    </section>
  );
}

function Addr({ value }: { value: string | null }) {
  return value ? <span className="mono tiny faint">{shortAddress(value)}</span> : null;
}

export function ReviewStep({ s, ctx, goTo, mode }: { s: WizardState; ctx: WizardContext; goTo: (step: number) => void; mode: "create" | "edit" }) {
  const total = goodsTotal(s);
  const amounts = effectiveAmounts(s);
  const code = ctx.asset.code;
  const party = (p: { appointed: boolean; name: string; address: string }) =>
    p.appointed ? (
      <>
        {p.name.trim()} <Addr value={p.address.trim()} />
      </>
    ) : (
      <span className="faint">Not appointed</span>
    );

  return (
    <div className={styles.review}>
      <p className={styles.reviewNote}>
        <strong>{mode === "create" ? "Creating saves a draft." : "Saving updates the draft."}</strong> Nothing is signed, deployed or funded. Freeze and deploy from the deal page; both parties then accept on-chain before the buyer funds.
      </p>

      <div className={styles.reviewGrid}>
        <Block title="Parties" onEdit={() => goTo(0)}>
          <dl className="kv">
            <dt>Deal</dt>
            <dd>
              {s.title.trim()} <span className="mono tiny faint">{s.poNumber.trim()}</span>
            </dd>
            <dt>Buyer</dt>
            <dd>
              {ctx.buyer.legalName} <Addr value={ctx.buyer.address} />
            </dd>
            <dt>Supplier</dt>
            <dd>
              {s.supplier.legalName.trim()} {s.supplier.contact === "address" ? <Addr value={s.supplier.signingAddress.trim()} /> : <span className="tiny faint">invite to {s.supplier.inviteEmail.trim()}</span>}
              {s.supplier.mode === "new" ? <span className="tiny faint"> · new</span> : null}
            </dd>
            <dt>Inspector</dt>
            <dd>{party(s.inspector)}</dd>
            <dt>Forwarder</dt>
            <dd>{party(s.forwarder)}</dd>
          </dl>
        </Block>

        <Block title="Goods and delivery" onEdit={() => goTo(1)}>
          <dl className="kv">
            <dt>Incoterms®</dt>
            <dd className="mono small">
              {s.incotermRule} {s.namedPlace.trim()} · 2020
            </dd>
            <dt>Route</dt>
            <dd>
              {s.originPort.trim()} to {s.destinationPort.trim()} <span className="tiny faint">· {s.transportMode}</span>
            </dd>
            <dt>Lines</dt>
            <dd>
              {s.lineItems.map((li) => {
                const lt = lineTotal(li);
                return (
                  <div key={li.key} className="small">
                    <span className="mono">{li.sku.trim()}</span> {li.quantity} {li.uom.trim()} × {li.unitPrice.trim()} = <span className="mono">{lt === null ? "-" : units(lt)}</span>
                  </div>
                );
              })}
            </dd>
          </dl>
        </Block>
      </div>

      <Block title="Economics and releases" onEdit={() => goTo(2)}>
        <ol className={styles.reviewMilestones}>
          {s.milestones.map((m, i) => {
            const u = safeUnits(amounts[i] ?? "");
            return (
              <li key={m.key}>
                <div className={styles.rmHead}>
                  <span className={styles.mTag}>M{i + 1}</span>
                  <strong>{m.name.trim()}</strong>
                  {u === null ? <span className="faint">-</span> : <Figure units={u} size="sm" />}
                </div>
                <p className={styles.rmCondition}>{m.condition.trim()}</p>
                <dl className={styles.rmMeta}>
                  <div>
                    <dt>Approval</dt>
                    <dd>
                      {m.quorum} of {m.approverRoles.join(", ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Documents</dt>
                    <dd>{m.requiredDocuments.length ? m.requiredDocuments.map((d) => DOCUMENT_TYPE_LABELS[d]).join(", ") : "None"}</dd>
                  </div>
                  <div>
                    <dt>Refund</dt>
                    <dd>{m.refundAfterDays.trim() === "0" ? "None" : `${m.refundAfterDays.trim()} days`}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
        <div className={styles.linesFoot}>
          <span>
            Held in escrow
            <span className="tiny faint" style={{ fontWeight: 400 }}>
              {" "}
              · {ctx.asset.networkLabel}
              {ctx.asset.isDemo ? ", demo token" : ""}
            </span>
          </span>
          <Figure units={total} code={code} size="sm" />
        </div>
      </Block>

      <div className={styles.reviewGrid}>
        <Block title="Documents and tolerances" onEdit={() => goTo(4)}>
          <dl className="kv">
            <dt>Quantity</dt>
            <dd className="mono small">{bpsLabel(s.quantityBps)}</dd>
            <dt>Weight</dt>
            <dd className="mono small">{bpsLabel(s.weightBps)}</dd>
          </dl>
        </Block>
        <Block title="Deadlines and disputes" onEdit={() => goTo(5)}>
          <dl className="kv">
            <dt>Funding</dt>
            <dd>{s.fundingDeadlineDays} days after saving</dd>
            <dt>Law</dt>
            <dd>{s.governingLaw.trim()}</dd>
            <dt>Forum</dt>
            <dd>{s.disputeForum.trim()}</dd>
            <dt>Resolver</dt>
            <dd>
              {s.resolver.name.trim()} <Addr value={s.resolver.address.trim()} />
            </dd>
          </dl>
        </Block>
      </div>
    </div>
  );
}
