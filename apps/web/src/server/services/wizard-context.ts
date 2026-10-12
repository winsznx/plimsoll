import type { KnownOrg, KnownParty, WizardContext } from "@/components/wizard/model";
import type { SessionContext } from "../auth/session";
import { isChainConfigured, network } from "../chain";
import { chainConfig, env } from "../env";
import { counterpartiesFor } from "./workspace";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything the deal wizard needs from the server: who the buyer signs as, the asset, and known parties. */
export async function wizardContext(session: SessionContext, extraOrg?: KnownOrg): Promise<WizardContext> {
  const net = network();
  const wallet = session.wallets.find((w) => w.network === net.id);
  const configured = isChainConfigured();
  const parties = await counterpartiesFor(session);

  const orgs: KnownOrg[] = parties.filter((p) => UUID.test(p.key) && (p.roles.includes("supplier") || p.roles.includes("buyer"))).map((p) => ({ orgId: p.key, name: p.name, addresses: p.addresses, dealRefs: [...new Set(p.deals.map((d) => d.reference))] }));
  if (extraOrg && !orgs.some((o) => o.orgId === extraOrg.orgId)) orgs.push(extraOrg);

  const knownFor = (role: "inspector" | "forwarder" | "resolver"): KnownParty[] => {
    const seen = new Set<string>();
    return parties
      .filter((p) => p.roles.includes(role))
      .flatMap((p) => p.addresses.map((address) => ({ name: p.name, address })))
      .filter((k) => (seen.has(k.address) ? false : (seen.add(k.address), true)));
  };

  return {
    buyer: { legalName: session.org?.legalName ?? session.user.displayName, address: wallet?.address ?? null },
    asset: { code: configured ? chainConfig().asset.code : env().PLIMSOLL_ASSET_CODE, isDemo: configured && chainConfig().asset.isDemo, networkLabel: net.label },
    orgs: orgs.sort((a, b) => a.name.localeCompare(b.name)),
    known: { inspector: knownFor("inspector"), forwarder: knownFor("forwarder"), resolver: knownFor("resolver") },
  };
}
