"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api";

export interface SwitchableOrg {
  id: string;
  name: string;
  role: string;
}

export function OrgSwitcherMenu({ orgs, activeOrgId }: { orgs: SwitchableOrg[]; activeOrgId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const switchTo = async (orgId: string) => {
    setBusy(true);
    try {
      await api("/session/org", { body: { orgId } });
      router.push("/overview");
      router.refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label htmlFor="org-switcher" className="sr-only">
        Active organization
      </label>
      <select id="org-switcher" className="input" value={activeOrgId ?? ""} disabled={busy} aria-busy={busy} onChange={(e) => switchTo(e.target.value)} style={{ width: "auto", maxWidth: "min(220px, 42vw)" }}>
        {activeOrgId === null ? <option value="">Choose organization</option> : null}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.role})
          </option>
        ))}
      </select>
    </>
  );
}
