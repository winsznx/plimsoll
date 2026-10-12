"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 2500;

/** Re-reads the page while extraction jobs run; unmounts its timer as soon as nothing is in flight. */
export function AnalysisPoller({ inFlight }: { inFlight: number }) {
  const router = useRouter();
  useEffect(() => {
    if (inFlight === 0) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, router]);
  return (
    <p className="tiny muted" aria-live="polite" role="status">
      {inFlight > 0 ? `Analysing ${inFlight} version${inFlight === 1 ? "" : "s"}. Updates automatically.` : ""}
    </p>
  );
}
