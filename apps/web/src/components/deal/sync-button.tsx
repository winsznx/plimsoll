"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "../toast";

/** Forces an independent ledger readback instead of waiting for the indexer. */
export function SyncButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ status: string; ledger?: number }>(`/deals/${dealId}/sync`, { method: "POST" });
          toast(r.status === "ok" ? `Read from ledger ${r.ledger}` : r.status === "unavailable" ? "RPC unavailable; nothing assumed." : "No escrow deployed yet.");
          router.refresh();
        } catch (e) {
          toast(errorMessage(e), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Reading…" : "Re-read ledger"}
    </button>
  );
}
