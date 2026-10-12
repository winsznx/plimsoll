import { ArrowLeft, Wallet } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { DealWizard } from "@/components/wizard/deal-wizard";
import { initialState } from "@/components/wizard/model";
import { requireSession } from "@/server/auth/guard";
import { wizardContext } from "@/server/services/wizard-context";
import styles from "./new.module.css";

export const metadata: Metadata = { title: "New deal" };

export default async function NewDealPage() {
  const session = await requireSession();
  const ctx = await wizardContext(session);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Deals · new</p>
          <h1 style={{ marginTop: 6 }}>Draft a deal</h1>
          <div className="sub">
            <span>Private draft. Nothing is signed or deployed until you freeze the terms.</span>
          </div>
        </div>
        <div className="btn-group">
          <Link className="btn" href="/deals">
            <ArrowLeft aria-hidden />
            Back to deals
          </Link>
        </div>
      </div>

      {!ctx.buyer.address ? (
        <div className={styles.notice} role="status">
          <Wallet weight="fill" aria-hidden />
          <span>
            <strong>No wallet on {ctx.asset.networkLabel}.</strong> The draft autosaves here, but creating it needs your buyer signing address.
          </span>
          <Link href="/settings">Connect in Settings</Link>
        </div>
      ) : null}

      <DealWizard ctx={ctx} initial={initialState({ hasKnownOrgs: ctx.orgs.length > 0 })} mode={{ kind: "create" }} />
    </>
  );
}
