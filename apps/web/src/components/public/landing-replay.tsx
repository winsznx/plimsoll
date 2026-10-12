"use client";

import { WarningOctagon } from "@phosphor-icons/react";
import { useState } from "react";
import { AccountPath } from "@/components/instruments/account-path";
import { Figure } from "@/components/instruments/figure";
import { LoadLineGauge } from "@/components/instruments/load-line-gauge";
import { TrancheRail } from "@/components/instruments/tranche-rail";
import type { Tranche, TrancheState } from "@/components/instruments/tranche";
import { SAMPLE_CODE, SAMPLE_MILESTONES, SAMPLE_TOTAL } from "./sample-deal";
import styles from "./landing-replay.module.css";

type Move = { kind: "note"; text: string; held?: boolean } | { kind: "path"; from: string; to: string; held?: boolean; amount: bigint; text: string };

interface Stage {
  label: string;
  tick: string;
  funded: boolean;
  states: readonly [TrancheState, TrancheState, TrancheState];
  /** The tranche this stage pays out, so the rail plays its release motion once. */
  pays?: number;
  move: Move;
}

const [M1, M2, M3] = SAMPLE_MILESTONES;

const STAGES: readonly [Stage, ...Stage[]] = [
  { label: "Drafted", tick: "Drafted", funded: false, states: ["waiting", "waiting", "waiting"], move: { kind: "note", text: "Terms frozen and hashed into a new escrow contract." } },
  { label: "Signed", tick: "Signed", funded: false, states: ["waiting", "waiting", "waiting"], move: { kind: "note", text: "Buyer and supplier sign the same terms digest on chain." } },
  { label: "Funded", tick: "Funded", funded: true, states: ["waiting", "waiting", "waiting"], move: { kind: "path", from: "Buyer", to: "Escrow", held: true, amount: SAMPLE_TOTAL, text: "Funded in full. All of it sits below the line." } },
  { label: "M1 released", tick: "M1 paid", funded: true, states: ["released", "waiting", "waiting"], pays: 0, move: { kind: "path", from: "Escrow", to: "Supplier", amount: M1.amount, text: "Buyer signs. M1 pays out." } },
  { label: "M2 held by mismatch", tick: "M2 held", funded: true, states: ["released", "held", "waiting"], move: { kind: "note", held: true, text: "Packing list 148 ctn, invoice 160 ctn. M2 stays held." } },
  { label: "M2 released", tick: "M2 paid", funded: true, states: ["released", "released", "waiting"], pays: 1, move: { kind: "path", from: "Escrow", to: "Supplier", amount: M2.amount, text: "List corrected, inspector signs. M2 pays out." } },
  { label: "Settled", tick: "Settled", funded: true, states: ["released", "released", "released"], pays: 2, move: { kind: "path", from: "Escrow", to: "Supplier", amount: M3.amount, text: "Receipt confirmed. Escrow is empty." } },
];

/** Steps the sample deal through its life; everything on the instruments is derived from the chosen stage. */
export function LandingReplay() {
  const [index, setIndex] = useState(4);
  const stage = STAGES[index] ?? STAGES[0];
  const tranches: Tranche[] = SAMPLE_MILESTONES.map((m, i) => ({ ordinal: m.ordinal, name: m.name, amount: m.amount, state: stage.states[i] ?? "waiting", fresh: stage.pays === i }));
  const funded = stage.funded ? SAMPLE_TOTAL : 0n;
  const released = tranches.filter((t) => t.state === "released").reduce((sum, t) => sum + t.amount, 0n);
  const move = stage.move;

  return (
    <section className={styles.panel} aria-label="Sample deal replay">
      <div className={styles.head}>
        <span className="eyebrow">Sample deal</span>
        <span className={styles.route}>Porcelain tile · Ningbo to Felixstowe</span>
      </div>

      <div className={styles.body}>
        <div className={styles.gauge}>
          <LoadLineGauge tranches={tranches} funded={funded} total={SAMPLE_TOTAL} code={SAMPLE_CODE} />
        </div>
        <div className={styles.readout}>
          <div>
            <span className="eyebrow">In escrow</span>
            <div className={styles.balance}>
              <Figure units={funded - released} code={SAMPLE_CODE} size="xl" />
            </div>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Total</dt>
              <dd>
                <Figure units={SAMPLE_TOTAL} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Funded</dt>
              <dd>
                <Figure units={funded} size="sm" />
              </dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>
                <Figure units={released} size="sm" />
              </dd>
            </div>
          </dl>
          <TrancheRail tranches={tranches} size="thick" labels legend />
        </div>
      </div>

      <p className={`${styles.event} ${move.held ? styles.eventHeld : ""}`} aria-live="polite">
        <span className={styles.stageName}>{stage.label}</span>
        {move.kind === "path" ? (
          <>
            <AccountPath from={move.from} to={move.to} held={move.held} />
            <Figure units={move.amount} size="sm" />
          </>
        ) : move.held ? (
          <WarningOctagon weight="fill" aria-hidden className={styles.heldIcon} />
        ) : null}
        <span className={styles.eventText}>{move.text}</span>
      </p>

      <div className={styles.scrub}>
        <input className={styles.range} type="range" min={0} max={STAGES.length - 1} step={1} value={index} onChange={(e) => setIndex(Number(e.currentTarget.value))} aria-label="Deal stage" aria-valuetext={stage.label} />
        <ol className={styles.ticks}>
          {STAGES.map((s, i) => (
            <li key={s.label}>
              <button type="button" className={`${styles.tick} ${i <= index ? styles.passed : ""}`} aria-pressed={i === index} aria-label={s.label} onClick={() => setIndex(i)}>
                <i aria-hidden="true" />
                <span aria-hidden="true">{s.tick}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
