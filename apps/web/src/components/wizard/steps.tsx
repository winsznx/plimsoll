"use client";

import { Trash } from "@phosphor-icons/react";
import Link from "next/link";
import type { ApproverRole, DocumentType } from "@plimsoll/domain";
import { Figure } from "@/components/instruments/figure";
import { percentOf, shortAddress, units } from "@/lib/format";
import { SelectField, TextAreaField, TextField } from "./fields";
import {
  APPROVER_ROLES,
  DOCUMENT_TYPE_LABELS,
  INCOTERM_RULES,
  TEMPLATE_BPS,
  TRANSPORT_MODES,
  bpsLabel,
  effectiveAmounts,
  emptyLineItem,
  emptyMilestone,
  goodsTotal,
  lineTotal,
  materializeAmounts,
  safeUnits,
  type KnownParty,
  type LineItemInput,
  type MilestoneInput,
  type PartyInput,
  type StepErrors,
  type WizardContext,
  type WizardState,
} from "./model";
import styles from "./wizard.module.css";

export interface StepProps {
  s: WizardState;
  ctx: WizardContext;
  errors: StepErrors;
  update: (fn: (s: WizardState) => WizardState) => void;
}

function setLine(update: StepProps["update"], i: number, patch: Partial<LineItemInput>) {
  update((s) => ({ ...s, lineItems: s.lineItems.map((li, j) => (j === i ? { ...li, ...patch } : li)) }));
}

function setMilestone(update: StepProps["update"], i: number, patch: Partial<MilestoneInput>) {
  update((s) => ({ ...s, milestones: s.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
}

function milestoneLabel(m: MilestoneInput, i: number): string {
  return `${i + 1}. ${m.name.trim() || "Untitled milestone"}`;
}

function evenBps(n: number): number[] {
  const each = Math.floor(10_000 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 10_000 - each * (n - 1) : each));
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3>{title}</h3>
        {sub ? <p>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

function AppointedParty({ role, label, party, known, errors, onChange, optional, explainer }: { role: "inspector" | "forwarder" | "resolver"; label: string; party: PartyInput; known: KnownParty[]; errors: StepErrors; onChange: (p: PartyInput) => void; optional: boolean; explainer: string }) {
  return (
    <div className="stack tight">
      {optional ? (
        <label className={styles.choice}>
          <input type="checkbox" checked={party.appointed} onChange={(e) => onChange({ ...party, appointed: e.target.checked })} />
          Appoint {label.toLowerCase()}
        </label>
      ) : null}
      <p className={styles.explainer}>{explainer}</p>
      {party.appointed ? (
        <div className="form-grid">
          {known.length > 0 ? (
            <SelectField
              id={`${role}-known`}
              className="full"
              label={`Fill from a ${label.toLowerCase()} on your other deals`}
              value={known.find((k) => k.address === party.address.trim() && k.name === party.name.trim()) ? party.address.trim() : ""}
              placeholder="Choose, or enter details below"
              onValue={(address) => {
                const k = known.find((x) => x.address === address);
                if (k) onChange({ ...party, name: k.name, address: k.address });
              }}
              options={known.map((k) => ({ value: k.address, label: `${k.name} · ${shortAddress(k.address)}` }))}
            />
          ) : null}
          <TextField id={`${role}-name`} label={`${label} name`} value={party.name} onValue={(v) => onChange({ ...party, name: v })} error={errors[`${role}.name`]} autoComplete="organization" />
          <TextField id={`${role}-address`} label="Signing address" value={party.address} onValue={(v) => onChange({ ...party, address: v.trim() })} error={errors[`${role}.address`]} inputClassName="mono" spellCheck={false} autoComplete="off" placeholder="G…" />
        </div>
      ) : null}
    </div>
  );
}

export function PartiesStep({ s, ctx, errors, update }: StepProps) {
  const org = ctx.orgs.find((o) => o.orgId === s.supplier.orgId);
  const supplier = s.supplier;
  const setSupplier = (patch: Partial<WizardState["supplier"]>) => update((x) => ({ ...x, supplier: { ...x.supplier, ...patch } }));
  return (
    <>
      <Section title="Agreement">
        <div className="form-grid">
          <TextField id="title" className="full" label="Deal title" value={s.title} onValue={(v) => update((x) => ({ ...x, title: v }))} error={errors.title} maxLength={120} placeholder="e.g. Porcelain tile, Ningbo to Felixstowe" />
          <TextField id="po" label="Purchase order number" value={s.poNumber} onValue={(v) => update((x) => ({ ...x, poNumber: v }))} error={errors.poNumber} maxLength={40} inputClassName="mono" />
        </div>
      </Section>

      <Section title="Buyer" sub="Funds the escrow. Signs with your linked wallet.">
        <dl className="kv">
          <dt>Legal name</dt>
          <dd>{ctx.buyer.legalName}</dd>
          <dt>Signs as</dt>
          <dd>
            {ctx.buyer.address ? (
              <span className="mono small">{ctx.buyer.address}</span>
            ) : (
              <span className="small" style={{ color: "var(--held-ink)" }}>
                No wallet on {ctx.asset.networkLabel}.{" "}
                <Link className="ext" href="/settings">
                  Connect one in Settings
                </Link>
              </span>
            )}
          </dd>
        </dl>
      </Section>

      <Section title="Supplier" sub="Paid on every milestone. Their address is written into the terms.">
        <div className="stack">
          <fieldset className={styles.fieldset}>
            <legend>Counterparty</legend>
            <div className={styles.choices}>
              <label className={styles.choice}>
                <input type="radio" name="supplier-mode" checked={supplier.mode === "existing"} disabled={ctx.orgs.length === 0} onChange={() => setSupplier({ mode: "existing" })} />
                From your existing deals
              </label>
              <label className={styles.choice}>
                <input type="radio" name="supplier-mode" checked={supplier.mode === "new"} onChange={() => setSupplier({ mode: "new", orgId: "" })} />
                New counterparty
              </label>
            </div>
            {ctx.orgs.length === 0 ? <p className="why-not">No counterparties from earlier deals yet.</p> : null}
          </fieldset>

          <div className="form-grid">
            {supplier.mode === "existing" ? (
              <SelectField
                id="supplier-org"
                className="full"
                label="Organization"
                value={supplier.orgId}
                placeholder="Choose a counterparty"
                error={errors["supplier.orgId"]}
                onValue={(orgId) => {
                  const o = ctx.orgs.find((x) => x.orgId === orgId);
                  if (!o) return;
                  setSupplier({ orgId, legalName: o.name, signingAddress: o.addresses[0] ?? "", contact: o.addresses.length > 0 ? "address" : "invite" });
                }}
                options={ctx.orgs.map((o) => ({ value: o.orgId, label: [o.name, o.addresses[0] ? shortAddress(o.addresses[0]) : "no signing address", o.dealRefs.join(", ")].filter(Boolean).join(" · ") }))}
              />
            ) : (
              <TextField id="supplier-name" className="full" label="Registered legal name" value={supplier.legalName} onValue={(v) => setSupplier({ legalName: v })} error={errors["supplier.legalName"]} autoComplete="organization" />
            )}
          </div>

          <fieldset className={styles.fieldset}>
            <legend>How the supplier signs</legend>
            <div className={styles.choices}>
              <label className={styles.choice}>
                <input type="radio" name="supplier-contact" checked={supplier.contact === "address"} onChange={() => setSupplier({ contact: "address" })} />
                I know their signing address
              </label>
              <label className={styles.choice}>
                <input type="radio" name="supplier-contact" checked={supplier.contact === "invite"} onChange={() => setSupplier({ contact: "invite" })} />
                Invite them by email
              </label>
            </div>
          </fieldset>

          <div className="form-grid">
            {supplier.contact === "address" ? (
              <>
                <TextField
                  id="supplier-address"
                  className="full"
                  inputClassName="mono"
                  label="Supplier signing address"
                  value={supplier.signingAddress}
                  onValue={(v) => setSupplier({ signingAddress: v.trim() })}
                  error={errors["supplier.signingAddress"]}
                  placeholder="G…"
                  spellCheck={false}
                  autoComplete="off"
                  list={org && org.addresses.length > 0 ? "supplier-addresses" : undefined}
                  hint={org && org.addresses.length > 0 ? `${org.addresses.length} address${org.addresses.length === 1 ? "" : "es"} used on earlier deals` : undefined}
                />
                {org ? (
                  <datalist id="supplier-addresses">
                    {org.addresses.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                ) : null}
              </>
            ) : (
              <TextField id="supplier-email" className="full" type="email" label="Invitation email" value={supplier.inviteEmail} onValue={(v) => setSupplier({ inviteEmail: v })} error={errors["supplier.inviteEmail"]} autoComplete="email" hint="They register their signing address from the invite. Terms can't freeze until then." />
            )}
          </div>
        </div>
      </Section>

      <Section title="Independent approvers" sub="Optional. They approve only the milestones you name and are never paid.">
        <div className="stack">
          <AppointedParty role="inspector" label="Inspector" party={s.inspector} known={ctx.known.inspector} errors={errors} optional onChange={(p) => update((x) => ({ ...x, inspector: p }))} explainer="Checks goods or documents. Co-signs releases." />
          <AppointedParty role="forwarder" label="Forwarder" party={s.forwarder} known={ctx.known.forwarder} errors={errors} optional onChange={(p) => update((x) => ({ ...x, forwarder: p }))} explainer="Attests shipment events for approvers." />
        </div>
      </Section>
    </>
  );
}

export function GoodsStep({ s, ctx, errors, update }: StepProps) {
  const total = goodsTotal(s);
  return (
    <>
      <Section title="Line items" sub={`Unit prices in ${ctx.asset.code}, up to 7 decimals.`}>
        {errors.lineItems ? <p className="err small">{errors.lineItems}</p> : null}
        <ol className={styles.lines}>
          {s.lineItems.map((li, i) => {
            const lt = lineTotal(li);
            const err = (f: string) => errors[`lineItems.${i}.${f}`];
            const cell = (f: keyof LineItemInput, label: string, caption: string, extra = "") => (
              <div className={styles[`c_${f}`]}>
                {i === 0 ? (
                  <span className={styles.cellCaption} aria-hidden="true">
                    {caption}
                  </span>
                ) : null}
                <input
                  className={`input ${styles.cellInput} ${extra}`}
                  aria-label={`Line ${i + 1} ${label}`}
                  value={li[f]}
                  onChange={(e) => setLine(update, i, { [f]: e.target.value })}
                  aria-invalid={err(f) ? true : undefined}
                  inputMode={f === "quantity" ? "numeric" : f === "unitPrice" ? "decimal" : undefined}
                  spellCheck={f === "description"}
                />
                {err(f) ? <div className="err tiny">{err(f)}</div> : null}
              </div>
            );
            return (
              <li key={li.key} className={styles.line}>
                <span className={styles.c_num} aria-hidden="true">
                  {i + 1}
                </span>
                {cell("sku", "SKU", "SKU", "mono")}
                {cell("description", "description", "Description")}
                {cell("quantity", "quantity", "Qty", styles.amount)}
                {cell("uom", "unit of measure", "Unit")}
                {cell("unitPrice", "unit price", "Unit price", styles.amount)}
                <div className={styles.c_total}>
                  {i === 0 ? (
                    <span className={styles.cellCaption} aria-hidden="true">
                      Line total
                    </span>
                  ) : null}
                  <span className={styles.lineTotal}>{lt === null ? <span className="faint">-</span> : units(lt)}</span>
                </div>
                <div className={styles.c_remove}>
                  <button type="button" className="btn ghost sm" onClick={() => update((x) => ({ ...x, lineItems: x.lineItems.filter((_, j) => j !== i) }))} disabled={s.lineItems.length === 1} aria-label={`Remove line ${i + 1}`} title="Remove line">
                    <Trash aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className={styles.linesFoot}>
          <span>Agreement total</span>
          <Figure units={total} code={ctx.asset.code} size="sm" />
        </div>
        <button type="button" className={`btn sm ${styles.addRow}`} disabled={s.lineItems.length >= 50} onClick={() => update((x) => ({ ...x, lineItems: [...x.lineItems, emptyLineItem()] }))}>
          Add line item
        </button>
      </Section>

      <Section title="Delivery terms" sub="Recorded as agreed. Plimsoll picks no Incoterms® rule.">
        <div className="form-grid">
          <SelectField id="incoterm" label="Incoterms® 2020 rule" value={s.incotermRule} placeholder="Choose a rule" error={errors.incotermRule} onValue={(v) => update((x) => ({ ...x, incotermRule: INCOTERM_RULES.find((r) => r === v) ?? "" }))} options={INCOTERM_RULES.map((r) => ({ value: r, label: r }))} />
          <TextField id="named-place" label="Named place" value={s.namedPlace} onValue={(v) => update((x) => ({ ...x, namedPlace: v }))} error={errors.namedPlace} hint="e.g. port of shipment for FOB" />
          <SelectField id="transport" label="Transport mode" value={s.transportMode} placeholder="Choose a mode" error={errors.transportMode} onValue={(v) => update((x) => ({ ...x, transportMode: TRANSPORT_MODES.find((m) => m === v) ?? "" }))} options={TRANSPORT_MODES.map((m) => ({ value: m, label: m[0]!.toUpperCase() + m.slice(1) }))} />
          <div />
          <TextField id="origin" label="Origin port or place" value={s.originPort} onValue={(v) => update((x) => ({ ...x, originPort: v }))} error={errors.originPort} />
          <TextField id="destination" label="Destination port or place" value={s.destinationPort} onValue={(v) => update((x) => ({ ...x, destinationPort: v }))} error={errors.destinationPort} />
        </div>
      </Section>
    </>
  );
}

export function EconomicsStep({ s, ctx, errors, update }: StepProps) {
  const total = goodsTotal(s);
  const amounts = effectiveAmounts(s);
  const sum = amounts.reduce((a, v) => a + (safeUnits(v) ?? 0n), 0n);
  const editAmount = (i: number, v: string) => update((x) => {
    const m = materializeAmounts(x);
    return { ...m, milestones: m.milestones.map((ms, j) => (j === i ? { ...ms, amount: v } : ms)) };
  });
  return (
    <>
      <Section title="Escrow asset">
        <dl className={styles.stats}>
          <div>
            <dt>Asset</dt>
            <dd className="mono">
              {ctx.asset.code}
              {ctx.asset.isDemo ? <span className="tiny faint"> demo, not USDC</span> : null}
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>{ctx.asset.networkLabel}</dd>
          </div>
          <div>
            <dt>Agreement total</dt>
            <dd>
              <Figure units={total} size="sm" />
            </dd>
          </div>
        </dl>
        {errors.total ? <p className="err small" style={{ marginTop: 10 }}>{errors.total}</p> : null}
      </Section>

      <Section title="Payment milestones" sub={s.autoSplitBps ? "Amounts follow the goods total. Edit one to set them by hand." : "Fixed as entered. Must sum to the total exactly."}>
        <div className={`table-scroll ${styles.bleed}`}>
          <table className={`table ${styles.tableTight}`}>
            <thead>
              <tr>
                <th scope="col">Milestone</th>
                <th scope="col" className="num">
                  Amount ({ctx.asset.code})
                </th>
                <th scope="col" className="num">
                  Share
                </th>
                <th scope="col">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {s.milestones.map((m, i) => {
                const u = safeUnits(amounts[i] ?? "");
                const nameErr = errors[`milestones.${i}.name`];
                const amtErr = errors[`milestones.${i}.amount`];
                return (
                  <tr key={m.key}>
                    <td>
                      <input className={`input ${styles.cellInput} ${styles.wide}`} aria-label={`Milestone ${i + 1} name`} value={m.name} maxLength={80} onChange={(e) => setMilestone(update, i, { name: e.target.value })} aria-invalid={nameErr ? true : undefined} />
                      {nameErr ? <div className="err tiny">{nameErr}</div> : null}
                    </td>
                    <td className="num">
                      <input className={`input ${styles.cellInput} ${styles.amount}`} aria-label={`Milestone ${i + 1} amount`} inputMode="decimal" value={amounts[i] ?? ""} onChange={(e) => editAmount(i, e.target.value)} aria-invalid={amtErr ? true : undefined} />
                      {amtErr ? <div className="err tiny">{amtErr}</div> : null}
                    </td>
                    <td className={`num ${styles.cellFigure}`}>{u !== null && total > 0n ? `${percentOf(u, total).toFixed(2)}%` : <span className="faint">-</span>}</td>
                    <td>
                      <button type="button" className="btn ghost sm" disabled={s.milestones.length === 1} aria-label={`Remove milestone ${i + 1}`} onClick={() => update((x) => { const m2 = materializeAmounts(x); return { ...m2, milestones: m2.milestones.filter((_, j) => j !== i) }; })} title="Remove milestone">
                        <Trash aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className={styles.totalRow}>
                <td>Allocated</td>
                <td className="num">
                  <Figure units={sum} size="sm" />
                </td>
                <td className="num">{total > 0n ? `${percentOf(sum, total).toFixed(2)}%` : "-"}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div aria-live="polite">{errors.milestoneSum ? <p className="err small" style={{ marginTop: 10 }}>{errors.milestoneSum}</p> : null}</div>
        <div className={`btn-group ${styles.addRow}`}>
          <button type="button" className="btn sm" disabled={s.milestones.length >= 12} onClick={() => update((x) => { const m2 = materializeAmounts(x); return { ...m2, milestones: [...m2.milestones, emptyMilestone()] }; })}>
            Add milestone
          </button>
          {s.milestones.length === TEMPLATE_BPS.length ? (
            <button type="button" className="btn sm" onClick={() => update((x) => ({ ...x, autoSplitBps: TEMPLATE_BPS }))}>
              Split 20 / 60 / 20
            </button>
          ) : null}
          <button type="button" className="btn sm" onClick={() => update((x) => ({ ...x, autoSplitBps: evenBps(x.milestones.length) }))}>
            Split evenly
          </button>
        </div>
        <p className={styles.explainer} style={{ marginTop: 10 }}>Splits use whole token units. Any remainder lands on the last milestone.</p>
      </Section>
    </>
  );
}

export function ReleasesStep({ s, errors, update }: StepProps) {
  const amounts = effectiveAmounts(s);
  const appointed = (role: ApproverRole) => role === "buyer" || role === "supplier" || (role === "inspector" && s.inspector.appointed) || (role === "forwarder" && s.forwarder.appointed);
  return (
    <Section title="Release conditions" sub="Each releases when its quorum signs the same anchored evidence.">
      <div className="stack">
        {s.milestones.map((m, i) => (
          <div key={m.key} className={styles.milestone}>
            <div className={styles.milestoneHead}>
              <h4>{milestoneLabel(m, i)}</h4>
              <Figure units={safeUnits(amounts[i] ?? "") ?? 0n} size="sm" />
            </div>
            <div className="stack tight">
              <TextAreaField id={`m${i}-condition`} label="Condition" value={m.condition} maxLength={400} onValue={(v) => setMilestone(update, i, { condition: v })} error={errors[`milestones.${i}.condition`]} />
              <div className={styles.approverRow}>
                <fieldset className={styles.fieldset} aria-describedby={errors[`milestones.${i}.approverRoles`] ? `m${i}-roles-err` : undefined}>
                  <legend>Approvers</legend>
                  <div className={styles.choices}>
                    {APPROVER_ROLES.map((role) => (
                      <label key={role} className={styles.choice}>
                        <input
                          type="checkbox"
                          checked={m.approverRoles.includes(role)}
                          onChange={(e) => {
                            const roles = e.target.checked ? APPROVER_ROLES.filter((r) => r === role || m.approverRoles.includes(r)) : m.approverRoles.filter((r) => r !== role);
                            const q = Number(m.quorum);
                            setMilestone(update, i, { approverRoles: roles, quorum: Number.isInteger(q) && q > roles.length ? String(Math.max(1, roles.length)) : m.quorum });
                          }}
                        />
                        {role[0]!.toUpperCase() + role.slice(1)}
                        {appointed(role) ? null : <span className="tiny faint">(not appointed)</span>}
                      </label>
                    ))}
                  </div>
                  {errors[`milestones.${i}.approverRoles`] ? (
                    <p id={`m${i}-roles-err`} className="err small">
                      {errors[`milestones.${i}.approverRoles`]}
                    </p>
                  ) : null}
                </fieldset>
                <div className={styles.quorum}>
                  <TextField id={`m${i}-quorum`} label="Signatures required" inputMode="numeric" value={m.quorum} onValue={(v) => setMilestone(update, i, { quorum: v.trim() })} error={errors[`milestones.${i}.quorum`]} hint={`of ${m.approverRoles.length} approver${m.approverRoles.length === 1 ? "" : "s"}`} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function DocumentsStep({ s, errors, update }: StepProps) {
  const docTypes = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];
  return (
    <>
      <Section title="Required documents" sub="Evidence bundles once each required document reconciles.">
        <div className="stack">
          {s.milestones.map((m, i) => (
            <fieldset key={m.key} className={`${styles.fieldset} ${styles.milestone}`}>
              <legend>{milestoneLabel(m, i)}</legend>
              <div className={styles.checks}>
                {docTypes.map((d) => (
                  <label key={d} className={styles.choice}>
                    <input
                      type="checkbox"
                      checked={m.requiredDocuments.includes(d)}
                      onChange={(e) => setMilestone(update, i, { requiredDocuments: e.target.checked ? docTypes.filter((x) => x === d || m.requiredDocuments.includes(x)) : m.requiredDocuments.filter((x) => x !== d) })}
                    />
                    {DOCUMENT_TYPE_LABELS[d]}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Section>
      <Section title="Reconciliation tolerances" sub="Inside tolerance warns. Beyond it blocks the milestone.">
        <div className="form-grid">
          <TextField id="tol-qty" label="Quantity tolerance (basis points)" inputMode="numeric" value={s.quantityBps} onValue={(v) => update((x) => ({ ...x, quantityBps: v.trim() }))} error={errors.quantityBps} hint={`${bpsLabel(s.quantityBps)} · 100 bps = 1%`} />
          <TextField id="tol-weight" label="Weight tolerance (basis points)" inputMode="numeric" value={s.weightBps} onValue={(v) => update((x) => ({ ...x, weightBps: v.trim() }))} error={errors.weightBps} hint={`${bpsLabel(s.weightBps)} · 100 bps = 1%`} />
        </div>
      </Section>
    </>
  );
}

export function DeadlinesStep({ s, ctx, errors, update }: StepProps) {
  return (
    <>
      <Section title="Deadlines" sub="Days count from save and become fixed dates.">
        <div className="form-grid">
          <TextField id="funding-days" label="Funding deadline (days)" inputMode="numeric" value={s.fundingDeadlineDays} onValue={(v) => update((x) => ({ ...x, fundingDeadlineDays: v.trim() }))} error={errors.fundingDeadlineDays} hint="1 to 365" />
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          {s.milestones.map((m, i) => (
            <TextField key={m.key} id={`m${i}-refund`} label={`Refund window: ${milestoneLabel(m, i)}`} inputMode="numeric" value={m.refundAfterDays} onValue={(v) => setMilestone(update, i, { refundAfterDays: v.trim() })} error={errors[`milestones.${i}.refundAfterDays`]} hint="Days until unreleased funds refund to the buyer. 0 = never." />
          ))}
        </div>
      </Section>
      <Section title="Disputes" sub="No default law, forum or arbitrator. State each.">
        <div className="form-grid">
          <TextField id="law" label="Governing law" value={s.governingLaw} onValue={(v) => update((x) => ({ ...x, governingLaw: v }))} error={errors.governingLaw} placeholder="e.g. England and Wales" />
          <TextField id="forum" label="Dispute forum" value={s.disputeForum} onValue={(v) => update((x) => ({ ...x, disputeForum: v }))} error={errors.disputeForum} placeholder="e.g. Named resolver, then the courts of …" />
        </div>
        <div className={styles.subBlock}>
          <h4>Resolver</h4>
          <AppointedParty role="resolver" label="Resolver" party={s.resolver} known={ctx.known.resolver} errors={errors} optional={false} onChange={(p) => update((x) => ({ ...x, resolver: { ...p, appointed: true } }))} explainer="Sole party who can split a disputed milestone. Independent of every other party." />
        </div>
      </Section>
    </>
  );
}
