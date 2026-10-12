use soroban_sdk::{contracterror, contracttype, Address, BytesN, Vec};

pub const MAX_MILESTONES: u32 = 12;
pub const MAX_APPROVERS: u32 = 8;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidPolicy = 1,
    InvalidAmount = 2,
    NotParty = 3,
    TermsDigestMismatch = 4,
    WrongStatus = 5,
    TokenMismatch = 6,
    OverFunded = 7,
    UnknownMilestone = 8,
    NotAppointedApprover = 9,
    EvidenceNotAnchored = 10,
    EvidenceDigestMismatch = 11,
    QuorumNotMet = 12,
    MilestoneNotOpen = 13,
    NotFullyFunded = 14,
    NotResolver = 15,
    AllocationMismatch = 16,
    RefundNotDue = 17,
    CancelNotAllowed = 18,
    ApprovalNotFound = 19,
    MilestoneDisputed = 20,
    Overflow = 21,
}

/// Terms for one tranche, fixed at deployment and covered by the accepted terms digest.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneSpec {
    pub amount: i128,
    pub payee: Address,
    pub approvers: Vec<Address>,
    pub quorum: u32,
    /// Ledger timestamp after which unreleased, undisputed funds may be returned to the buyer.
    /// Zero disables the refund path for this milestone.
    pub refund_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgreementPolicy {
    pub milestones: Vec<MilestoneSpec>,
    pub resolver: Address,
    /// Ledger timestamp after which a partially funded agreement may be cancelled and refunded.
    pub funding_deadline: u64,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AgreementStatus {
    AwaitingAcceptance = 0,
    AwaitingFunding = 1,
    Funded = 2,
    Completed = 3,
    Cancelled = 4,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MilestoneStatus {
    Open = 0,
    Disputed = 1,
    Released = 2,
    Resolved = 3,
    Refunded = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Agreement {
    pub deal_id: BytesN<32>,
    pub buyer: Address,
    pub supplier: Address,
    pub token: Address,
    pub terms_digest: BytesN<32>,
    pub resolver: Address,
    pub funding_deadline: u64,
    pub total: i128,
    pub funded: i128,
    pub released: i128,
    pub refunded: i128,
    pub status: AgreementStatus,
    pub buyer_accepted: bool,
    pub supplier_accepted: bool,
    pub milestone_count: u32,
    pub settled_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub id: u32,
    pub amount: i128,
    pub payee: Address,
    pub approvers: Vec<Address>,
    pub quorum: u32,
    pub refund_after: u64,
    pub evidence_digest: Option<BytesN<32>>,
    pub status: MilestoneStatus,
    pub dispute_reason: Option<BytesN<32>>,
}

/// Resolver allocation of a disputed milestone. Must sum to the milestone amount exactly.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resolution {
    pub to_buyer: i128,
    pub to_payee: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Agreement,
    Milestone(u32),
    Approval(u32, Address),
}
