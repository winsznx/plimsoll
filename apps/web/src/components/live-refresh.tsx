"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { fmtDateTime } from "@/lib/format";

const REFRESH_MS = 8_000;

interface Props {
  /** True while some ledger or worker outcome is still pending; the page re-reads itself only then. */
  active: boolean;
  /** When the server last read this deal's escrow from the ledger. */
  ledgerReadAt: string | null;
}

/**
 * Re-renders the server page on an interval while work is in flight, and stops while the tab is
 * hidden so background tabs cost nothing. Serverless hosting rules out push channels.
 */
export function LiveRefresh({ active, ledgerReadAt }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      timer ??= setInterval(() => router.refresh(), REFRESH_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      router.refresh();
      start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, router]);

  if (!active) return null;
  return (
    <p className="tiny muted" style={{ margin: "0 0 16px" }} role="status" aria-live="polite" data-live-refresh="">
      {ledgerReadAt ? `Updated from ledger at ${fmtDateTime(ledgerReadAt)}.` : "No ledger read yet."} Work is in flight, so this page re-reads itself every few seconds while it is open.
    </p>
  );
}
