use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DealCreated {
    #[topic]
    pub deal_id: BytesN<32>,
    pub buyer: Address,
    pub supplier: Address,
    pub token: Address,
    pub terms_digest: BytesN<32>,
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TermsAccepted {
    #[topic]
    pub deal_id: BytesN<32>,
    pub signer: Address,
    pub terms_digest: BytesN<32>,
    pub fully_accepted: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowFunded {
    #[topic]
    pub deal_id: BytesN<32>,
    pub amount: i128,
    pub funded: i128,
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceAnchored {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub submitter: Address,
    pub bundle_digest: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApproved {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub signer: Address,
    pub bundle_digest: BytesN<32>,
    pub approvals: u32,
    pub quorum: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApprovalRevoked {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub signer: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneReleased {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub payee: Address,
    pub amount: i128,
    pub bundle_digest: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeOpened {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub actor: Address,
    pub reason_digest: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeResolved {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub resolver: Address,
    pub to_buyer: i128,
    pub to_payee: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundExecuted {
    #[topic]
    pub deal_id: BytesN<32>,
    #[topic]
    pub milestone_id: u32,
    pub buyer: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DealCancelled {
    #[topic]
    pub deal_id: BytesN<32>,
    pub actor: Address,
    pub refunded: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DealCompleted {
    #[topic]
    pub deal_id: BytesN<32>,
    pub released: i128,
    pub refunded: i128,
}
