import { env } from "../env";
import type { EmailMessage } from "./index";

/**
 * Message builders. Emails only point people to Plimsoll: no document contents, amounts,
 * addresses or other deal data go in a body (PRD S12).
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function absoluteUrl(path: string): string {
  return new URL(path, env().PLIMSOLL_ORIGIN).toString();
}

function compose(tag: EmailMessage["tag"], to: string, subject: string, lines: string[], action: { label: string; url: string }, footer: string): EmailMessage {
  const text = [...lines, "", `${action.label}: ${action.url}`, "", footer].join("\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#14202b;max-width:560px">`,
    ...lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`),
    `<p style="margin:20px 0"><a href="${escapeHtml(action.url)}" style="color:#0b5c7a;font-weight:600">${escapeHtml(action.label)}</a></p>`,
    `<p style="margin:0;color:#5b6b78;font-size:12px">${escapeHtml(footer)}</p>`,
    `</div>`,
  ].join("");
  return { tag, to, subject, text, html };
}

const UNSOLICITED = "If you did not expect this email, you can ignore it. Nothing happens unless the link is used.";

export function verificationEmail(to: string, displayName: string, token: string): EmailMessage {
  return compose(
    "email.verify",
    to,
    "Confirm your email for Plimsoll",
    [`Hello ${displayName},`, "Confirm this address to create and submit trade agreements on Plimsoll. The link works once and expires in 24 hours."],
    { label: "Confirm email", url: absoluteUrl(`/verify-email/${token}`) },
    UNSOLICITED,
  );
}

export function dealInviteEmail(to: string, input: { buyer: string; reference: string; role: string; token: string; expiresAt: Date }): EmailMessage {
  return compose(
    "deal.invite",
    to,
    `${input.buyer} invited you to agreement ${input.reference} on Plimsoll`,
    [`${input.buyer} invited you to join agreement ${input.reference} as ${input.role}.`, `Open the invitation to see who is asking before you sign in or link a wallet. It expires ${input.expiresAt.toUTCString()}.`],
    { label: "Review the invitation", url: absoluteUrl(`/invite/${input.token}`) },
    UNSOLICITED,
  );
}

export function orgInviteEmail(to: string, input: { org: string; inviter: string; role: string; token: string; expiresAt: Date }): EmailMessage {
  return compose(
    "org.invite",
    to,
    `${input.inviter} invited you to ${input.org} on Plimsoll`,
    [`${input.inviter} invited you to join ${input.org} on Plimsoll as ${input.role}.`, `Sign in or register with this email address to accept. The invitation expires ${input.expiresAt.toUTCString()}.`],
    { label: "Review the invitation", url: absoluteUrl(`/join/${input.token}`) },
    UNSOLICITED,
  );
}

export function notificationEmail(to: string, title: string, path: string): EmailMessage {
  return compose("notification", to, title, [title], { label: "Open in Plimsoll", url: absoluteUrl(path) }, `You receive these because email notifications are on. Turn them off in Settings: ${absoluteUrl("/settings#email")}`);
}
