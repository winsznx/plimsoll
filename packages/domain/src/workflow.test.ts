import { describe, expect, it } from "vitest";
import { conservationHolds, milestoneGate, type ChainMilestone, type ChainSnapshot, type GateContext } from "./index";

const BUYER = "GBUYER";
const SUPPLIER = "GSUPPLIER";
const INSPECTOR = "GINSPECTOR";
const RESOLVER = "GRESOLVER";

function snapshot(milestone: Partial<ChainMilestone> = {}, status: ChainSnapshot["agreement"]["status"] = "Funded"): ChainSnapshot {
  const m: ChainMilestone = { id: 1, amount: 100n, payee: SUPPLIER, approvers: [BUYER, INSPECTOR], quorum: 2, refundAfter: 0, evidenceDigest: null, status: "Open", disputeReason: null, approvals: [], ...milestone };
  return {
    contractId: "C",
    ledger: 1,
    readAt: "",
    agreement: { dealId: "d", buyer: BUYER, supplier: SUPPLIER, token: "T", termsDigest: "t", resolver: RESOLVER, fundingDeadline: 0, total: 100n, funded: status === "Funded" ? 100n : 0n, released: 0n, refunded: 0n, status, buyerAccepted: true, supplierAccepted: true, milestoneCount: 1, settledCount: 0 },
    milestones: [m],
    balance: status === "Funded" ? 100n : 0n,
  };
}

function ctx(s: ChainSnapshot, actor: string | null, offchain: Partial<GateContext["offchain"][number]> = {}): GateContext {
  return { snapshot: s, offchain: [{ ordinal: 1, openBlockingFindings: 0, preparedBundleDigest: "e1", missingDocuments: [], ...offchain }], actorAddress: actor, nowSeconds: 1_000, names: new Map([[INSPECTOR, "Tidewater"]]) };
}

describe("milestoneGate", () => {
  it("blocks anchoring while a blocking finding is open", () => {
    // #given
    const s = snapshot();
    // #when
    const gate = milestoneGate(ctx(s, SUPPLIER, { openBlockingFindings: 1 }), s.milestones[0]!);
    // #then
    expect(gate.blockedReasons.anchor_evidence).toMatch(/1 blocking discrepancy remains open/);
  });

  it("names the missing approver when quorum is short", () => {
    // #given
    const s = snapshot({ evidenceDigest: "e1", approvals: [BUYER] });
    // #when
    const gate = milestoneGate(ctx(s, BUYER), s.milestones[0]!);
    // #then
    expect(gate.blockedReasons.release).toBe("Awaiting 1 more approval on current evidence (Tidewater).");
  });

  it("allows release only at quorum on funded escrow", () => {
    // #given
    const s = snapshot({ evidenceDigest: "e1", approvals: [BUYER, INSPECTOR] });
    // #when
    const gate = milestoneGate(ctx(s, null), s.milestones[0]!);
    // #then
    expect(gate.phase).toBe("eligible");
  });

  it("refuses approval of stale anchored evidence", () => {
    // #given
    const s = snapshot({ evidenceDigest: "old" });
    // #when
    const gate = milestoneGate(ctx(s, INSPECTOR, { preparedBundleDigest: "new" }), s.milestones[0]!);
    // #then
    expect(gate.allowed).not.toContain("approve");
  });

  it("only the named resolver may resolve a disputed milestone", () => {
    // #given
    const s = snapshot({ status: "Disputed" });
    // #when
    const buyerGate = milestoneGate(ctx(s, BUYER), s.milestones[0]!);
    const resolverGate = milestoneGate(ctx(s, RESOLVER), s.milestones[0]!);
    // #then
    expect([buyerGate.allowed.includes("resolve_dispute"), resolverGate.allowed.includes("resolve_dispute")]).toEqual([false, true]);
  });

  it("keeps release closed before funding", () => {
    // #given
    const s = snapshot({ evidenceDigest: "e1", approvals: [BUYER, INSPECTOR] }, "AwaitingFunding");
    // #when
    const gate = milestoneGate(ctx(s, BUYER), s.milestones[0]!);
    // #then
    expect(gate.blockedReasons.release).toBe("Escrow is not fully funded yet.");
  });
});

describe("conservationHolds", () => {
  it("detects a balance that does not match accounting", () => {
    // #given
    const s = { ...snapshot(), balance: 99n };
    // #then
    expect(conservationHolds(s)).toBe(false);
  });
});
