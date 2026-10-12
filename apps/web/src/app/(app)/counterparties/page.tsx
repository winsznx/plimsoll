import { AddressBook, ShieldCheck } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/chip";
import { Hash } from "@/components/hash";
import { VerificationChip } from "@/components/workspace/verification-chip";
import { STATUS_LABEL } from "@/lib/format";
import { requireSession } from "@/server/auth/guard";
import { explorer } from "@/server/chain";
import { counterpartiesFor } from "@/server/services/workspace";
import styles from "./counterparties.module.css";

export const metadata: Metadata = { title: "Counterparties" };

export default async function CounterpartiesPage() {
  const session = await requireSession();
  const parties = await counterpartiesFor(session);
  const invited = parties.filter((p) => p.invited).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Counterparties</h1>
          <div className="sub">
            <span>
              {parties.length} part{parties.length === 1 ? "y" : "ies"} on your deals
            </span>
            {invited > 0 ? <Chip tone="awaiting">{invited} invite{invited === 1 ? "" : "s"} pending</Chip> : null}
          </div>
        </div>
      </div>

      <p className={styles.note}>
        <ShieldCheck weight="fill" aria-hidden />
        Verified means business identity was checked. An email or a wallet never verifies.
      </p>

      <section className="panel" aria-label="Counterparty directory">
        {parties.length === 0 ? (
          <p className={styles.empty}>
            <AddressBook aria-hidden />
            No counterparties yet.{" "}
            <Link className="ext" href="/deals/new">
              Draft a deal
            </Link>
          </p>
        ) : (
          <div className="table-scroll">
            <table className={`table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Verification</th>
                  <th scope="col">Roles</th>
                  <th scope="col" className="num">
                    Deals
                  </th>
                  <th scope="col">On</th>
                  <th scope="col">Signing address</th>
                  <th scope="col">Access</th>
                </tr>
              </thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <div className={styles.name}>{p.name}</div>
                      <div className={styles.line}>{p.jurisdiction ?? "No jurisdiction"}</div>
                    </td>
                    <td>
                      <VerificationChip state={p.verification} hint={false} />
                    </td>
                    <td className={styles.roles}>{p.roles.join(" · ")}</td>
                    <td className="num mono">{p.deals.length}</td>
                    <td>
                      <div className={styles.refs}>
                        {p.deals.map((d) => (
                          <Link key={`${d.id}-${d.role}`} className={styles.ref} href={`/deals/${d.id}`} title={`As ${d.role} · ${STATUS_LABEL[d.status] ?? d.status}`}>
                            {d.reference}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td>
                      {p.addresses.length === 0 ? (
                        <span className="faint tiny">None yet</span>
                      ) : (
                        <div className={styles.addresses}>
                          {p.addresses.map((a) => (
                            <Hash key={a} value={a} href={explorer("account", a)} label={`${p.name} signing address`} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td>{p.invited ? <Chip tone="awaiting">Invited</Chip> : <Chip tone="neutral">Active</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className={styles.foot}>Inspectors, forwarders and resolvers see only the deals that name them.</p>
    </>
  );
}
