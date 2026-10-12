"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Chip } from "@/components/chip";
import { useToast } from "@/components/toast";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { MemberView, PendingInviteView } from "@/server/services/org-members";
import styles from "./workspace.module.css";

type Role = MemberView["role"];
type InviteRole = "admin" | "member";
type Delivery = "sent" | "logged" | "bounced" | "failed";

const ROLES: Role[] = ["owner", "admin", "member"];

const DELIVERY_NOTE: Record<Delivery, string> = {
  sent: "Invitation emailed.",
  logged: "Email is off on this server. The invite went to the server log. Share the link below.",
  bounced: "The address rejected it. Check it, or share the link below.",
  failed: "Sending failed. Share the link below, or invite again later.",
};

interface Props {
  members: MemberView[];
  invites: PendingInviteView[];
  manageBlocked: string | null;
  inviteRoles: { role: InviteRole; blocked: string | null }[];
  emailVerified: boolean;
}

function MemberRow({ m, busy, canManage, onRole, onRemove }: { m: MemberView; busy: boolean; canManage: boolean; onRole: (m: MemberView, role: Role) => void; onRemove: (m: MemberView) => void }) {
  const [confirming, setConfirming] = useState(false);
  const roleOptions = ROLES.filter((r) => r === m.role || m.roleBlocked[r] === null);
  const roleLocked = roleOptions.length <= 1;
  // Role and removal limits that apply to every row are explained once below the table.
  const roleWhy = roleLocked ? (Object.values(m.roleBlocked).find((r) => r?.includes("last owner")) ?? null) : null;
  const removeWhy = m.removeBlocked && (m.isYou || canManage) ? m.removeBlocked : null;
  const removeLabel = m.isYou ? "Leave" : "Remove";

  return (
    <tr>
      <td>
        <div className="small" style={{ fontWeight: 600 }}>
          {m.displayName}
          {m.isYou ? <span className="tiny muted"> (you)</span> : null}
        </div>
        <div className="tiny muted">{m.email}</div>
      </td>
      <td>
        <label className="sr-only" htmlFor={`role-${m.userId}`}>
          Role for {m.displayName}
        </label>
        <select id={`role-${m.userId}`} className="input" value={m.role} disabled={busy || roleLocked} onChange={(e) => onRole(m, e.target.value as Role)} style={{ minWidth: 112, textTransform: "capitalize" }}>
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {roleWhy ? <p className="why-not">{roleWhy}</p> : null}
      </td>
      <td className="mono tiny">{fmtDate(m.joinedAt)}</td>
      <td>
        {confirming ? (
          <div className="btn-group">
            <button type="button" className="btn sm danger" disabled={busy} onClick={() => onRemove(m)}>
              Confirm {removeLabel.toLowerCase()}
            </button>
            <button type="button" className="btn sm ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="btn sm ghost" disabled={busy || m.removeBlocked !== null} onClick={() => setConfirming(true)}>
              {removeLabel}
            </button>
            {removeWhy ? <p className="why-not">{removeWhy}</p> : null}
          </>
        )}
      </td>
    </tr>
  );
}

export function MembersPanel({ members, invites, manageBlocked, inviteRoles, emailVerified }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; joinUrl: string; delivery: Delivery } | null>(null);
  const allowedRoles = inviteRoles.filter((r) => r.blocked === null).map((r) => r.role);
  const inviteBlocked = manageBlocked ?? (!emailVerified ? "Verify your email before inviting colleagues." : null);
  const isOwner = members.some((m) => m.isYou && m.role === "owner");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = (m: MemberView, role: Role) =>
    run(async () => {
      await api(`/org/members/${m.userId}`, { method: "PATCH", body: { role } });
      toast(`${m.displayName} is now ${role}`);
    });

  const remove = (m: MemberView) =>
    run(async () => {
      await api(`/org/members/${m.userId}`, { method: "DELETE" });
      toast(m.isYou ? "You left the organization" : `${m.displayName} removed`);
    });

  const revoke = (inv: PendingInviteView) =>
    run(async () => {
      await api("/org/invites", { method: "DELETE", body: { id: inv.id } });
      toast(`Invitation to ${inv.email} withdrawn`);
    });

  const invite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ email: string; joinUrl: string; delivery: Delivery }>("/org/invites", { body: { email: String(data.get("email") ?? "").trim(), role: data.get("role") }, idempotencyKey: newIdempotencyKey() });
      setSent(r);
      form.reset();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`panel-body flush table-scroll ${styles.scrollBox}`} tabIndex={0} role="region" aria-label="Members">
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Joined</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.userId} m={m} busy={busy} canManage={manageBlocked === null} onRole={changeRole} onRemove={remove} />
            ))}
          </tbody>
        </table>
      </div>
      {isOwner ? null : (
        <div className="panel-body" style={{ padding: "10px 18px", borderTop: "1px solid var(--line)" }}>
          <p className="why-not" style={{ marginTop: 0 }}>Only owners change roles.</p>
        </div>
      )}

      {manageBlocked === null ? (
        <div className="panel-body stack" style={{ borderTop: "1px solid var(--line)" }}>
          <h3 className={styles.subhead}>Pending invitations</h3>
          {invites.length === 0 ? (
            <p className="small muted">None open. Invitations expire after 7 days.</p>
          ) : (
            <div className={`table-scroll ${styles.deliveries}`} tabIndex={0} role="region" aria-label="Pending invitations">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Invited by</th>
                    <th>Expires</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.id}>
                      <td className="small">{inv.email}</td>
                      <td>
                        <Chip tone="awaiting">{inv.role}</Chip>
                      </td>
                      <td className="small">{inv.invitedBy}</td>
                      <td className="mono tiny">{fmtDateTime(inv.expiresAt)}</td>
                      <td>
                        <button type="button" className="btn sm ghost" disabled={busy} onClick={() => revoke(inv)}>
                          Withdraw
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sent ? (
            <div className={`callout ${sent.delivery === "sent" ? "ok" : ""}`} role="status">
              <span className="mark" aria-hidden="true">
                {sent.delivery === "sent" ? "✓" : "i"}
              </span>
              <div className="stack tight" style={{ minWidth: 0 }}>
                <p>
                  <strong>Invitation for {sent.email} created.</strong> {DELIVERY_NOTE[sent.delivery]}
                </p>
                <p className="mono tiny" style={{ overflowWrap: "anywhere" }}>
                  {sent.joinUrl}
                </p>
                <p className="tiny muted">Only {sent.email} can accept. Shown once.</p>
                <div>
                  <button type="button" className="btn sm ghost" onClick={() => setSent(null)}>
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <form onSubmit={invite} className="stack tight" aria-label="Invite a member">
            <h3 className={styles.subhead}>Invite</h3>
            <div className={styles.inlineForm}>
              <div className="field grow">
                <label htmlFor="invite-email">Email</label>
                <input id="invite-email" name="email" type="email" className="input" required maxLength={254} placeholder="colleague@company.com" disabled={busy || inviteBlocked !== null} />
              </div>
              <div className="field" style={{ minWidth: 130 }}>
                <label htmlFor="invite-role">Role</label>
                <select id="invite-role" name="role" className="input" defaultValue="member" disabled={busy || inviteBlocked !== null} style={{ textTransform: "capitalize" }}>
                  {allowedRoles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn primary" disabled={busy || inviteBlocked !== null}>
                {busy ? "Working…" : "Send invitation"}
              </button>
            </div>
            {inviteBlocked ? <p className="why-not">{inviteBlocked}</p> : allowedRoles.length < inviteRoles.length ? <p className="tiny faint">Admins invite members. An owner invites admins.</p> : null}
            <p className={`${styles.statusLine} ${styles.error}`} role="status" aria-live="polite">
              {error}
            </p>
          </form>
        </div>
      ) : (
        <div className="panel-body" style={{ borderTop: "1px solid var(--line)" }}>
          <p className="why-not">{manageBlocked}</p>
        </div>
      )}
    </>
  );
}
