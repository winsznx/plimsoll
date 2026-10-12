/**
 * Serializable view models passed from server components and API routes to client components.
 * Money is always a decimal string of integer token units; never a JS number.
 */
import type { DealTerms, FindingSide, MilestoneGate, SourceSpan } from "@plimsoll/domain";

export type Units = string;

export interface ParticipantView {
  role: "buyer" | "supplier" | "inspector" | "forwarder" | "resolver";
  name: string;
  address: string | null;
  status: "active" | "invited";
  isMe: boolean;
}

export interface MilestoneView {
  ordinal: number;
  name: string;
  condition: string;
  amount: Units;
  payee: string;
  payeeName: string;
  approvers: { address: string; name: string; role: string; approved: boolean }[];
  quorum: number;
  refundAfter: number;
  requiredDocuments: string[];
  chainStatus: "Open" | "Disputed" | "Released" | "Resolved" | "Refunded" | null;
  evidenceDigest: string | null;
  preparedDigest: string | null;
  gate: MilestoneGate | null;
  missingDocuments: string[];
  openBlockingFindings: number;
  settlementTx: TxView | null;
}

export interface TxView {
  id: string;
  kind: string;
  milestoneOrdinal: number | null;
  actorAddress: string;
  actorName: string;
  status: string;
  txHash: string | null;
  ledger: number | null;
  amount: Units | null;
  errorCode: string | null;
  errorDetail: string | null;
  createdAt: string;
  explorerUrl: string | null;
}

export interface ChainSummary {
  contractId: string;
  contractExplorerUrl: string | null;
  status: string;
  total: Units;
  funded: Units;
  released: Units;
  refunded: Units;
  balance: Units;
  buyerAccepted: boolean;
  supplierAccepted: boolean;
  ledger: number;
  syncedAt: string | null;
  syncStatus: "never" | "ok" | "unavailable";
  conservationHolds: boolean;
}

export interface DealView {
  id: string;
  reference: string;
  publicRef: string;
  title: string;
  status: string;
  version: number;
  isSample: boolean;
  network: { id: string; label: string };
  asset: { code: string; issuer: string; contractId: string; isDemo: boolean };
  terms: DealTerms;
  termsDigest: string | null;
  deployTxHash: string | null;
  deployExplorerUrl: string | null;
  chain: ChainSummary | null;
  participants: ParticipantView[];
  myRoles: string[];
  myAddresses: string[];
  mySigning: "demo_custodial" | "wallet" | "none";
  milestones: MilestoneView[];
  documentsSummary: { total: number; analyzed: number; processing: number; openBlocking: number; openWarnings: number };
  transactions: TxView[];
  shipment: ShipmentView | null;
  disputes: DisputeView[];
}

export interface ShipmentView {
  id: string;
  stage: string;
  transportMode: string;
  incoterm: string;
  namedPlace: string;
  originPort: string;
  destinationPort: string;
  vessel: string | null;
  voyage: string | null;
  carrierRef: string | null;
  events: { id: string; eventCode: string; description: string; occurredAt: string; recordedAt: string; sourceType: string; sourceRef: string | null; isAttestation: boolean; signerAddress: string | null; signerName: string | null }[];
}

export interface DisputeView {
  id: string;
  milestoneOrdinal: number;
  reason: string;
  reasonDigest: string;
  openedBy: string;
  status: string;
  resolverAddress: string;
  resolution: { toBuyer: Units; toPayee: Units; rationale: string } | null;
  openTxHash: string | null;
  resolutionTxHash: string | null;
  createdAt: string;
  statements: { id: string; author: string; role: string; body: string; createdAt: string }[];
}

export interface DocumentVersionView {
  id: string;
  version: number;
  sha256: string;
  mediaType: string;
  bytes: number;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  analysisState: string;
  analysisError: string | null;
  detectedType: string | null;
  pages: number | null;
  /** Model that filled fields the rules could not read, when one was consulted. */
  modelUsed: string | null;
}

export interface DocumentView {
  id: string;
  documentType: string;
  title: string;
  versions: DocumentVersionView[];
}

export interface FieldView {
  key: string;
  value: string;
  span: SourceSpan;
  confidence: number;
  method: string;
}

export interface LineItemView {
  sku: string;
  description: string;
  quantity: number;
  uom: string;
  unitPrice: string | null;
  lineTotal: string | null;
  grossWeightKg: string | null;
  span: SourceSpan;
}

export interface DiscrepancyView {
  id: string;
  ruleId: string;
  field: string;
  severity: "blocking" | "warning" | "info";
  confidence: number;
  message: string;
  expected: FindingSide;
  actual: FindingSide;
  state: string;
  active: boolean;
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  explanation: string | null;
  explanationModel: string | null;
  /** A value this finding compares was read by the model, not a rule; reviewers must check the original. */
  modelExtracted: boolean;
}

export interface ActivityItem {
  id: string;
  at: string;
  who: string;
  what: string;
  source: "app" | "chain" | "system";
  dealId: string | null;
  dealReference: string | null;
  evidence: Record<string, unknown>;
  txHash: string | null;
  explorerUrl: string | null;
}
