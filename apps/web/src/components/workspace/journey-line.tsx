import type { ShipmentView } from "@/lib/views";
import styles from "./workspace.module.css";

const MAX_MARKS = 4;

export function stageLabel(stage: string): string {
  const s = stage.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface Props {
  shipment: ShipmentView;
  stages: readonly string[];
  /** Which stage each event code reports, so markers sit on the stop they advanced. */
  stageOf: Readonly<Record<string, string>>;
  size?: "sm" | "lg";
}

/**
 * The consignment drawn as a track from origin to destination. Stops fill up to the reported stage;
 * each recorded event is a marker on the stop it reports, solid when attested, hollow when context.
 */
export function JourneyLine({ shipment, stages, stageOf, size = "sm" }: Props) {
  const reached = stages.indexOf(shipment.stage);
  const byStage = new Map<string, ShipmentView["events"]>();
  for (const e of shipment.events) {
    const st = stageOf[e.eventCode];
    if (st) byStage.set(st, [...(byStage.get(st) ?? []), e]);
  }
  const current = reached >= 0 ? stageLabel(stages[reached] ?? shipment.stage) : stageLabel(shipment.stage);

  return (
    <div className={`${styles.journey} ${size === "lg" ? styles.journeyLg : ""}`}>
      <div className={styles.ports}>
        <span>{shipment.originPort}</span>
        <span>{shipment.destinationPort}</span>
      </div>
      <ol className={styles.track} aria-label={`Journey ${shipment.originPort} to ${shipment.destinationPort}. Reported stage: ${current}.`}>
        {stages.map((stage, i) => {
          const events = [...(byStage.get(stage) ?? [])].reverse();
          const attested = events.filter((e) => e.isAttestation).length;
          const state = i < reached ? styles.passed : i === reached ? styles.here : "";
          return (
            <li key={stage} className={`${styles.stop} ${state}`}>
              <span className={styles.marks} aria-hidden="true">
                {events.slice(0, MAX_MARKS).map((e) => (
                  <i key={e.id} className={e.isAttestation ? styles.attested : styles.context} title={`${e.eventCode} · ${e.isAttestation ? "attested" : "context"}`} />
                ))}
                {events.length > MAX_MARKS ? <small>+{events.length - MAX_MARKS}</small> : null}
              </span>
              <span className={styles.node} aria-hidden="true" />
              <span className={styles.stopLabel}>{stageLabel(stage)}</span>
              <span className="sr-only">
                {i < reached ? "reported" : i === reached ? "current" : "not reported"}
                {events.length ? `, ${events.length} event${events.length === 1 ? "" : "s"}, ${attested} attested` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={styles.journeyCaption}>
        {current} · {Math.max(reached + 1, 0)}/{stages.length}
      </p>
    </div>
  );
}

export function JourneyLegend() {
  return (
    <ul className={styles.legend}>
      <li>
        <i className={styles.attested} aria-hidden="true" />
        Attested
      </li>
      <li>
        <i className={styles.context} aria-hidden="true" />
        Context
      </li>
      <li>
        <span className={`${styles.node} ${styles.legendNode}`} aria-hidden="true" />
        Reported stage
      </li>
    </ul>
  );
}
