import type { Icon } from "@phosphor-icons/react";
import { Anchor, BellSimple, ChatText, CheckCircle, CurrencyCircleDollar, FileText, Scales, Signature, UserPlus, Vault, WarningOctagon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/chip";
import { MarkAllReadButton, NotificationLink } from "@/components/workspace/notification-actions";
import { fmtDate } from "@/lib/format";
import { requireSession } from "@/server/auth/guard";
import { notificationsFor } from "@/server/services/workspace";
import styles from "./notifications.module.css";

export const metadata: Metadata = { title: "Notifications" };

type Tone = "moved" | "held" | "plain";

const KIND: Record<string, [Icon, Tone]> = {
  "escrow.milestone_released": [CurrencyCircleDollar, "moved"],
  "escrow.dispute_resolved": [Scales, "moved"],
  "escrow.refund_executed": [CurrencyCircleDollar, "moved"],
  "escrow.completed": [CheckCircle, "moved"],
  "escrow.funded": [Vault, "plain"],
  "escrow.milestone_approved": [Signature, "plain"],
  "escrow.terms_accepted": [Signature, "plain"],
  "escrow.dispute_opened": [Scales, "held"],
  "document.discrepancy": [WarningOctagon, "held"],
  finding: [WarningOctagon, "held"],
  "shipment.event": [Anchor, "plain"],
  "dispute.statement": [ChatText, "plain"],
  "invite.accepted": [UserPlus, "plain"],
  "terms.ready": [FileText, "plain"],
};

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export default async function NotificationsPage() {
  const session = await requireSession();
  const items = await notificationsFor(session);
  const unread = items.filter((n) => n.readAt === null).length;
  const days: { day: string; rows: typeof items }[] = [];
  for (const n of items) {
    const day = fmtDate(n.createdAt);
    const last = days.at(-1);
    if (last && last.day === day) last.rows.push(n);
    else days.push({ day, rows: [n] });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <div className="sub">
            <span>
              {unread} unread of {items.length}
            </span>
          </div>
        </div>
        <MarkAllReadButton unread={unread} />
      </div>

      <div className={styles.layout}>
        <section className="panel" aria-label="Notification list">
          {items.length === 0 ? (
            <p className={styles.empty}>
              <BellSimple aria-hidden />
              You&apos;re up to date.{" "}
              <Link className="ext" href="/deals">
                Open deals
              </Link>
            </p>
          ) : (
            days.map((d) => (
              <div key={d.day}>
                <h2 className={styles.day}>
                  {d.day}
                  <span>{d.rows.length}</span>
                </h2>
                <ul className={styles.list}>
                  {d.rows.map((n) => {
                    const isUnread = n.readAt === null;
                    const [KindIcon, tone] = KIND[n.kind] ?? [BellSimple, "plain"];
                    return (
                      <li key={n.id} className={`${styles.item} ${isUnread ? styles.unread : ""}`}>
                        <KindIcon className={`${styles.icon} ${styles[tone]}`} weight={tone === "plain" ? "regular" : "fill"} aria-hidden />
                        <div className={styles.text}>
                          <p className={styles.title}>
                            {isUnread ? <span className="sr-only">Unread: </span> : null}
                            {n.title}
                          </p>
                          <p className={styles.body}>{n.body}</p>
                        </div>
                        <time className={styles.time} dateTime={new Date(n.createdAt).toISOString()}>
                          {TIME.format(new Date(n.createdAt))}
                        </time>
                        <NotificationLink id={n.id} href={n.href} unread={isUnread} label={`Open: ${n.title}`} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </section>

        <aside className="panel" aria-label="Delivery channels">
          <div className="panel-head">
            <h2 className={styles.h2}>Delivery</h2>
          </div>
          <dl className={styles.channels}>
            <div>
              <dt>In-app</dt>
              <dd>
                <Chip tone="confirmed">On</Chip>
              </dd>
            </div>
            <div>
              <dt>Email digests</dt>
              <dd>
                <Chip tone="neutral">Not configured</Chip>
              </dd>
            </div>
            <div>
              <dt>Webhooks</dt>
              <dd>
                <Link className="ext" href="/settings#integrations">
                  Settings
                </Link>
              </dd>
            </div>
          </dl>
          <p className={styles.foot}>No email provider on this deployment. Notifications only link; document contents never leave the deal.</p>
        </aside>
      </div>
    </>
  );
}
