import type { ChainSnapshot } from "@plimsoll/domain";
import type { StoredSnapshot } from "../db/schema";

export function storeSnapshot(s: ChainSnapshot): StoredSnapshot {
  return {
    ...s,
    agreement: { ...s.agreement, total: String(s.agreement.total), funded: String(s.agreement.funded), released: String(s.agreement.released), refunded: String(s.agreement.refunded) },
    milestones: s.milestones.map((m) => ({ ...m, amount: String(m.amount) })),
    balance: String(s.balance),
  };
}

export function loadSnapshot(s: StoredSnapshot): ChainSnapshot {
  return {
    ...s,
    agreement: { ...s.agreement, total: BigInt(s.agreement.total), funded: BigInt(s.agreement.funded), released: BigInt(s.agreement.released), refunded: BigInt(s.agreement.refunded) },
    milestones: s.milestones.map((m) => ({ ...m, amount: BigInt(m.amount) })),
    balance: BigInt(s.balance),
  };
}
