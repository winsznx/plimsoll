#![no_std]

//! Plimsoll trade escrow: one immutable contract instance per deal.
//!
//! The contract holds a single, fixed Stellar Asset Contract balance and releases it per
//! milestone only when appointed approvers have signed the currently anchored evidence digest.
//! There is no admin, no upgrade entrypoint and no sweep: every token movement is one of
//! `release_milestone`, `resolve_dispute`, `refund_expired` or `cancel_unfunded`.

mod events;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, contractmeta, panic_with_error, token, Address, BytesN, Env, Vec,
};

pub use types::*;

contractmeta!(key = "binver", val = "1.0.0");
contractmeta!(key = "product", val = "plimsoll-trade-escrow");

const DAY_IN_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;

#[contract]
pub struct TradeEscrow;

#[contractimpl]
impl TradeEscrow {
    pub fn __constructor(
        env: Env,
        deal_id: BytesN<32>,
        buyer: Address,
        supplier: Address,
        token: Address,
        terms_digest: BytesN<32>,
        policy: AgreementPolicy,
    ) {
        if let Err(e) = validate_policy(&buyer, &supplier, &policy) {
            panic_with_error!(&env, e);
        }

        let mut total: i128 = 0;
        for (i, spec) in policy.milestones.iter().enumerate() {
            total = match total.checked_add(spec.amount) {
                Some(t) => t,
                None => panic_with_error!(&env, Error::Overflow),
            };
            let milestone = Milestone {
                id: i as u32,
                amount: spec.amount,
                payee: spec.payee,
                approvers: spec.approvers,
                quorum: spec.quorum,
                refund_after: spec.refund_after,
                evidence_digest: None,
                status: MilestoneStatus::Open,
                dispute_reason: None,
            };
            put_milestone(&env, &milestone);
        }

        let agreement = Agreement {
            deal_id: deal_id.clone(),
            buyer: buyer.clone(),
            supplier: supplier.clone(),
            token: token.clone(),
            terms_digest: terms_digest.clone(),
            resolver: policy.resolver,
            funding_deadline: policy.funding_deadline,
            total,
            funded: 0,
            released: 0,
            refunded: 0,
            status: AgreementStatus::AwaitingAcceptance,
            buyer_accepted: false,
            supplier_accepted: false,
            milestone_count: policy.milestones.len(),
            settled_count: 0,
        };
        put_agreement(&env, &agreement);
        extend_instance(&env);

        events::DealCreated {
            deal_id,
            buyer,
            supplier,
            token,
            terms_digest,
            total,
        }
        .publish(&env);
    }

    /// Buyer or supplier binds their signature to the exact terms digest fixed at deployment.
    pub fn accept_terms(env: Env, signer: Address, terms_digest: BytesN<32>) -> Result<(), Error> {
        signer.require_auth();
        let mut a = get_agreement(&env);
        if a.status != AgreementStatus::AwaitingAcceptance {
            return Err(Error::WrongStatus);
        }
        if terms_digest != a.terms_digest {
            return Err(Error::TermsDigestMismatch);
        }
        if signer == a.buyer {
            a.buyer_accepted = true;
        } else if signer == a.supplier {
            a.supplier_accepted = true;
        } else {
            return Err(Error::NotParty);
        }
        if a.buyer_accepted && a.supplier_accepted {
            a.status = AgreementStatus::AwaitingFunding;
        }
        put_agreement(&env, &a);

        events::TermsAccepted {
            deal_id: a.deal_id.clone(),
            signer,
            terms_digest,
            fully_accepted: a.status == AgreementStatus::AwaitingFunding,
        }
        .publish(&env);
        Ok(())
    }

    /// Moves `amount` of the agreement token from the buyer into escrow. The token argument is
    /// explicit so a client that targets the wrong asset fails loudly instead of silently.
    pub fn fund(env: Env, buyer: Address, token: Address, amount: i128) -> Result<(), Error> {
        buyer.require_auth();
        let mut a = get_agreement(&env);
        if buyer != a.buyer {
            return Err(Error::NotParty);
        }
        if a.status != AgreementStatus::AwaitingFunding {
            return Err(Error::WrongStatus);
        }
        if token != a.token {
            return Err(Error::TokenMismatch);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let funded = a.funded.checked_add(amount).ok_or(Error::Overflow)?;
        if funded > a.total {
            return Err(Error::OverFunded);
        }

        token::Client::new(&env, &a.token).transfer(
            &buyer,
            &env.current_contract_address(),
            &amount,
        );

        a.funded = funded;
        if a.funded == a.total {
            a.status = AgreementStatus::Funded;
        }
        put_agreement(&env, &a);

        events::EscrowFunded {
            deal_id: a.deal_id.clone(),
            amount,
            funded: a.funded,
            total: a.total,
        }
        .publish(&env);
        Ok(())
    }

    /// Records the canonical evidence bundle digest for a milestone. Replacing the digest
    /// invalidates every approval signed against the previous one.
    pub fn anchor_evidence(
        env: Env,
        submitter: Address,
        milestone_id: u32,
        bundle_digest: BytesN<32>,
    ) -> Result<(), Error> {
        submitter.require_auth();
        let a = get_agreement(&env);
        if a.status != AgreementStatus::AwaitingFunding && a.status != AgreementStatus::Funded {
            return Err(Error::WrongStatus);
        }
        let mut m = get_milestone(&env, milestone_id)?;
        if m.status != MilestoneStatus::Open {
            return Err(Error::MilestoneNotOpen);
        }
        let is_party = submitter == a.buyer || submitter == a.supplier;
        if !is_party && !m.approvers.contains(&submitter) {
            return Err(Error::NotParty);
        }

        m.evidence_digest = Some(bundle_digest.clone());
        put_milestone(&env, &m);

        events::EvidenceAnchored {
            deal_id: a.deal_id,
            milestone_id,
            submitter,
            bundle_digest,
        }
        .publish(&env);
        Ok(())
    }

    /// An appointed approver signs the exact evidence digest currently anchored on the milestone.
    pub fn approve_milestone(
        env: Env,
        signer: Address,
        milestone_id: u32,
        bundle_digest: BytesN<32>,
    ) -> Result<(), Error> {
        signer.require_auth();
        let a = get_agreement(&env);
        if a.status != AgreementStatus::AwaitingFunding && a.status != AgreementStatus::Funded {
            return Err(Error::WrongStatus);
        }
        let m = get_milestone(&env, milestone_id)?;
        if m.status != MilestoneStatus::Open {
            return Err(Error::MilestoneNotOpen);
        }
        if !m.approvers.contains(&signer) {
            return Err(Error::NotAppointedApprover);
        }
        let current = m.evidence_digest.clone().ok_or(Error::EvidenceNotAnchored)?;
        if current != bundle_digest {
            return Err(Error::EvidenceDigestMismatch);
        }

        let key = DataKey::Approval(milestone_id, signer.clone());
        env.storage().persistent().set(&key, &bundle_digest);
        extend_persistent(&env, &key);

        events::MilestoneApproved {
            deal_id: a.deal_id,
            milestone_id,
            signer,
            bundle_digest,
            approvals: count_approvals(&env, &m),
            quorum: m.quorum,
        }
        .publish(&env);
        Ok(())
    }

    pub fn revoke_approval(env: Env, signer: Address, milestone_id: u32) -> Result<(), Error> {
        signer.require_auth();
        let a = get_agreement(&env);
        let m = get_milestone(&env, milestone_id)?;
        if m.status != MilestoneStatus::Open {
            return Err(Error::MilestoneNotOpen);
        }
        let key = DataKey::Approval(milestone_id, signer.clone());
        if !env.storage().persistent().has(&key) {
            return Err(Error::ApprovalNotFound);
        }
        env.storage().persistent().remove(&key);

        events::ApprovalRevoked {
            deal_id: a.deal_id,
            milestone_id,
            signer,
        }
        .publish(&env);
        Ok(())
    }

    /// Permissionless: anyone may execute a release once every predicate holds, because the
    /// predicates, payee and amount are all fixed by contract state rather than the caller.
    pub fn release_milestone(env: Env, milestone_id: u32) -> Result<i128, Error> {
        let mut a = get_agreement(&env);
        if a.status != AgreementStatus::Funded {
            return Err(Error::NotFullyFunded);
        }
        let mut m = get_milestone(&env, milestone_id)?;
        match m.status {
            MilestoneStatus::Open => {}
            MilestoneStatus::Disputed => return Err(Error::MilestoneDisputed),
            _ => return Err(Error::MilestoneNotOpen),
        }
        let digest = m.evidence_digest.clone().ok_or(Error::EvidenceNotAnchored)?;
        if count_approvals(&env, &m) < m.quorum {
            return Err(Error::QuorumNotMet);
        }

        m.status = MilestoneStatus::Released;
        put_milestone(&env, &m);
        a.released = a.released.checked_add(m.amount).ok_or(Error::Overflow)?;
        settle_one(&mut a);
        put_agreement(&env, &a);

        token::Client::new(&env, &a.token).transfer(
            &env.current_contract_address(),
            &m.payee,
            &m.amount,
        );

        events::MilestoneReleased {
            deal_id: a.deal_id.clone(),
            milestone_id,
            payee: m.payee,
            amount: m.amount,
            bundle_digest: digest,
        }
        .publish(&env);
        publish_completed_if_done(&env, &a);
        Ok(m.amount)
    }

    /// Buyer or supplier freezes one unreleased milestone. Released milestones are final.
    pub fn open_dispute(
        env: Env,
        actor: Address,
        milestone_id: u32,
        reason_digest: BytesN<32>,
    ) -> Result<(), Error> {
        actor.require_auth();
        let a = get_agreement(&env);
        if actor != a.buyer && actor != a.supplier {
            return Err(Error::NotParty);
        }
        if a.status != AgreementStatus::Funded {
            return Err(Error::WrongStatus);
        }
        let mut m = get_milestone(&env, milestone_id)?;
        if m.status != MilestoneStatus::Open {
            return Err(Error::MilestoneNotOpen);
        }
        m.status = MilestoneStatus::Disputed;
        m.dispute_reason = Some(reason_digest.clone());
        put_milestone(&env, &m);

        events::DisputeOpened {
            deal_id: a.deal_id,
            milestone_id,
            actor,
            reason_digest,
        }
        .publish(&env);
        Ok(())
    }

    /// The resolver fixed in the accepted terms splits a disputed milestone between buyer and
    /// payee. The split must account for the full milestone amount, no more and no less.
    pub fn resolve_dispute(
        env: Env,
        resolver: Address,
        milestone_id: u32,
        allocation: Resolution,
    ) -> Result<(), Error> {
        resolver.require_auth();
        let mut a = get_agreement(&env);
        if resolver != a.resolver {
            return Err(Error::NotResolver);
        }
        let mut m = get_milestone(&env, milestone_id)?;
        if m.status != MilestoneStatus::Disputed {
            return Err(Error::WrongStatus);
        }
        if allocation.to_buyer < 0 || allocation.to_payee < 0 {
            return Err(Error::InvalidAmount);
        }
        let sum = allocation
            .to_buyer
            .checked_add(allocation.to_payee)
            .ok_or(Error::Overflow)?;
        if sum != m.amount {
            return Err(Error::AllocationMismatch);
        }

        m.status = MilestoneStatus::Resolved;
        put_milestone(&env, &m);
        a.refunded = a.refunded.checked_add(allocation.to_buyer).ok_or(Error::Overflow)?;
        a.released = a.released.checked_add(allocation.to_payee).ok_or(Error::Overflow)?;
        settle_one(&mut a);
        put_agreement(&env, &a);

        let tok = token::Client::new(&env, &a.token);
        let this = env.current_contract_address();
        if allocation.to_buyer > 0 {
            tok.transfer(&this, &a.buyer, &allocation.to_buyer);
        }
        if allocation.to_payee > 0 {
            tok.transfer(&this, &m.payee, &allocation.to_payee);
        }

        events::DisputeResolved {
            deal_id: a.deal_id.clone(),
            milestone_id,
            resolver,
            to_buyer: allocation.to_buyer,
            to_payee: allocation.to_payee,
        }
        .publish(&env);
        publish_completed_if_done(&env, &a);
        Ok(())
    }

    /// Permissionless: once a milestone's predeclared refund deadline passes without release
    /// or dispute, its funds return to the buyer.
    pub fn refund_expired(env: Env, milestone_id: u32) -> Result<i128, Error> {
        let mut a = get_agreement(&env);
        if a.status != AgreementStatus::Funded {
            return Err(Error::WrongStatus);
        }
        let mut m = get_milestone(&env, milestone_id)?;
        match m.status {
            MilestoneStatus::Open => {}
            MilestoneStatus::Disputed => return Err(Error::MilestoneDisputed),
            _ => return Err(Error::MilestoneNotOpen),
        }
        if m.refund_after == 0 || env.ledger().timestamp() < m.refund_after {
            return Err(Error::RefundNotDue);
        }

        m.status = MilestoneStatus::Refunded;
        put_milestone(&env, &m);
        a.refunded = a.refunded.checked_add(m.amount).ok_or(Error::Overflow)?;
        settle_one(&mut a);
        put_agreement(&env, &a);

        token::Client::new(&env, &a.token).transfer(
            &env.current_contract_address(),
            &a.buyer,
            &m.amount,
        );

        events::RefundExecuted {
            deal_id: a.deal_id.clone(),
            milestone_id,
            buyer: a.buyer.clone(),
            amount: m.amount,
        }
        .publish(&env);
        publish_completed_if_done(&env, &a);
        Ok(m.amount)
    }

    /// Cancels an agreement that never became fully funded. Before any funding either party may
    /// cancel; after partial funding only once the funding deadline has passed, and any partial
    /// deposit returns to the buyer.
    pub fn cancel_unfunded(env: Env, actor: Address) -> Result<(), Error> {
        actor.require_auth();
        let mut a = get_agreement(&env);
        if actor != a.buyer && actor != a.supplier {
            return Err(Error::NotParty);
        }
        if a.status != AgreementStatus::AwaitingAcceptance
            && a.status != AgreementStatus::AwaitingFunding
        {
            return Err(Error::CancelNotAllowed);
        }
        let deadline_passed =
            a.funding_deadline != 0 && env.ledger().timestamp() >= a.funding_deadline;
        if a.funded > 0 && !deadline_passed {
            return Err(Error::CancelNotAllowed);
        }

        let refund = a.funded;
        a.refunded = refund;
        a.status = AgreementStatus::Cancelled;
        put_agreement(&env, &a);

        if refund > 0 {
            token::Client::new(&env, &a.token).transfer(
                &env.current_contract_address(),
                &a.buyer,
                &refund,
            );
        }

        events::DealCancelled {
            deal_id: a.deal_id,
            actor,
            refunded: refund,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_agreement(env: Env) -> Agreement {
        get_agreement(&env)
    }

    pub fn get_milestone(env: Env, milestone_id: u32) -> Result<Milestone, Error> {
        get_milestone(&env, milestone_id)
    }

    /// Approvers whose stored approval matches the milestone's current evidence digest.
    pub fn get_approvals(env: Env, milestone_id: u32) -> Result<Vec<Address>, Error> {
        let m = get_milestone(&env, milestone_id)?;
        let mut out = Vec::new(&env);
        if let Some(digest) = m.evidence_digest {
            for approver in m.approvers.iter() {
                let stored: Option<BytesN<32>> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Approval(milestone_id, approver.clone()));
                if stored == Some(digest.clone()) {
                    out.push_back(approver);
                }
            }
        }
        Ok(out)
    }

    /// Escrow balance as reported by the token contract itself, not by internal accounting.
    pub fn get_balance(env: Env) -> i128 {
        let a = get_agreement(&env);
        token::Client::new(&env, &a.token).balance(&env.current_contract_address())
    }

    /// Permissionless TTL maintenance so long-lived escrow never archives critical state.
    pub fn extend_ttl(env: Env) {
        extend_instance(&env);
        let a = get_agreement(&env);
        extend_persistent(&env, &DataKey::Agreement);
        for id in 0..a.milestone_count {
            extend_persistent(&env, &DataKey::Milestone(id));
            let m = get_milestone(&env, id).unwrap();
            for approver in m.approvers.iter() {
                let key = DataKey::Approval(id, approver);
                if env.storage().persistent().has(&key) {
                    extend_persistent(&env, &key);
                }
            }
        }
    }
}

fn validate_policy(buyer: &Address, supplier: &Address, policy: &AgreementPolicy) -> Result<(), Error> {
    if buyer == supplier {
        return Err(Error::InvalidPolicy);
    }
    let n = policy.milestones.len();
    if n == 0 || n > MAX_MILESTONES {
        return Err(Error::InvalidPolicy);
    }
    for spec in policy.milestones.iter() {
        if spec.amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let approvers = spec.approvers.len();
        if approvers == 0 || approvers > MAX_APPROVERS {
            return Err(Error::InvalidPolicy);
        }
        if spec.quorum == 0 || spec.quorum > approvers {
            return Err(Error::InvalidPolicy);
        }
        for (i, a) in spec.approvers.iter().enumerate() {
            if spec.approvers.first_index_of(&a) != Some(i as u32) {
                return Err(Error::InvalidPolicy);
            }
        }
    }
    Ok(())
}

fn count_approvals(env: &Env, m: &Milestone) -> u32 {
    let Some(digest) = m.evidence_digest.clone() else {
        return 0;
    };
    let mut count = 0;
    for approver in m.approvers.iter() {
        let stored: Option<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::Approval(m.id, approver));
        if stored.as_ref() == Some(&digest) {
            count += 1;
        }
    }
    count
}

fn settle_one(a: &mut Agreement) {
    a.settled_count += 1;
    if a.settled_count == a.milestone_count {
        a.status = AgreementStatus::Completed;
    }
}

fn publish_completed_if_done(env: &Env, a: &Agreement) {
    if a.status == AgreementStatus::Completed {
        events::DealCompleted {
            deal_id: a.deal_id.clone(),
            released: a.released,
            refunded: a.refunded,
        }
        .publish(env);
    }
}

fn get_agreement(env: &Env) -> Agreement {
    extend_instance(env);
    env.storage().persistent().get(&DataKey::Agreement).unwrap()
}

fn put_agreement(env: &Env, a: &Agreement) {
    env.storage().persistent().set(&DataKey::Agreement, a);
    extend_persistent(env, &DataKey::Agreement);
}

fn get_milestone(env: &Env, id: u32) -> Result<Milestone, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Milestone(id))
        .ok_or(Error::UnknownMilestone)
}

fn put_milestone(env: &Env, m: &Milestone) {
    let key = DataKey::Milestone(m.id);
    env.storage().persistent().set(&key, m);
    extend_persistent(env, &key);
}

fn extend_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, ttl_target(env));
}

fn extend_persistent(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, TTL_THRESHOLD, ttl_target(env));
}

fn ttl_target(env: &Env) -> u32 {
    TTL_EXTEND_TO.min(env.storage().max_ttl())
}
