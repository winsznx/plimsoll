"use client";

import { Checks } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/components/toast";

export function MarkAllReadButton({ unread }: { unread: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const markAll = async () => {
    setBusy(true);
    try {
      await api<{ ok: true }>("/notifications", { body: { ids: "all" } });
      toast("All notifications marked read");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack tight" style={{ alignItems: "flex-end" }}>
      <button type="button" className="btn" onClick={markAll} disabled={busy || unread === 0} aria-describedby={unread === 0 ? "mark-why-not" : undefined}>
        <Checks aria-hidden />
        {busy ? "Marking…" : "Mark all read"}
      </button>
      {unread === 0 ? (
        <p className="why-not" id="mark-why-not">
          Nothing unread.
        </p>
      ) : null}
    </div>
  );
}

/** Opening an unread notification marks it read first, so the badge matches what was seen. */
export function NotificationLink({ id, href, unread, label }: { id: string; href: string; unread: boolean; label: string }) {
  const router = useRouter();

  const open = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (!unread || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    try {
      await api<{ ok: true }>("/notifications", { body: { ids: [id] } });
    } catch (err) {
      console.warn("Could not mark notification read", errorMessage(err));
    }
    router.push(href);
  };

  return (
    <a className="btn sm" href={href} onClick={open} aria-label={label}>
      Open
    </a>
  );
}
