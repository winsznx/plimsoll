extern crate std;

use crate::{
    AgreementPolicy, AgreementStatus, Error, MilestoneSpec, MilestoneStatus, Resolution,
    TradeEscrow, TradeEscrowClient,
};
use soroban_sdk::{
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, IntoVal,
};

const TOTAL: i128 = 148_600_0000000; // 148,600.00 at 7 decimals
const M0: i128 = 29_720_0000000;
const M1: i128 = 89_160_0000000;
const M2: i128 = 29_720_0000000;
const REFUND_AFTER: u64 = 2_000_000;
const FUNDING_DEADLINE: u64 = 1_500_000;

struct Fixture<'a> {
    env: Env,
    escrow: TradeEscrowClient<'a>,
    token: TokenClient<'a>,
    buyer: Address,
    supplier: Address,
    inspector: Address,
    resolver: Address,
    terms: BytesN<32>,
}

fn digest(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn policy(env: &Env, buyer: &Address, supplier: &Address, inspector: &Address, resolver: &Address) -> AgreementPolicy {
    AgreementPolicy {
        milestones: vec![
            env,
            MilestoneSpec {
                amount: M0,
                payee: supplier.clone(),
                approvers: vec![env, buyer.clone()],
                quorum: 1,
                refund_after: 0,
            },
            MilestoneSpec {
                amount: M1,
                payee: supplier.clone(),
                approvers: vec![env, buyer.clone(), inspector.clone()],
                quorum: 2,
                refund_after: 0,
            },
            MilestoneSpec {
                amount: M2,
                payee: supplier.clone(),
                approvers: vec![env, buyer.clone()],
                quorum: 1,
                refund_after: REFUND_AFTER,
            },
        ],
        resolver: resolver.clone(),
        funding_deadline: FUNDING_DEADLINE,
    }
}

fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = TokenClient::new(&env, &sac.address());
    let token_admin = StellarAssetClient::new(&env, &sac.address());

    let buyer = Address::generate(&env);
    let supplier = Address::generate(&env);
    let inspector = Address::generate(&env);
    let resolver = Address::generate(&env);
    let terms = digest(&env, 0xAA);

    let escrow_id = env.register(
        TradeEscrow,
        (
            digest(&env, 0x01),
            buyer.clone(),
            supplier.clone(),
            sac.address(),
            terms.clone(),
            policy(&env, &buyer, &supplier, &inspector, &resolver),
        ),
    );
    let escrow = TradeEscrowClient::new(&env, &escrow_id);
    token_admin.mint(&buyer, &(TOTAL * 2));

    Fixture { env, escrow, token, buyer, supplier, inspector, resolver, terms }
}

fn accepted<'a>() -> Fixture<'a> {
    let f = setup();
    f.escrow.accept_terms(&f.buyer, &f.terms);
    f.escrow.accept_terms(&f.supplier, &f.terms);
    f
}

fn funded<'a>() -> Fixture<'a> {
    let f = accepted();
    f.escrow.fund(&f.buyer, &f.token.address, &TOTAL);
    f
}

fn assert_conservation(f: &Fixture) {
    let a = f.escrow.get_agreement();
    assert_eq!(a.funded, a.released + a.refunded + f.escrow.get_balance());
    assert_eq!(f.escrow.get_balance(), f.token.balance(&f.escrow.address));
}

#[test]
fn happy_path_releases_each_tranche_exactly_once() {
    let f = funded();
    assert_eq!(f.escrow.get_agreement().status, AgreementStatus::Funded);
    assert_eq!(f.token.balance(&f.escrow.address), TOTAL);

    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    assert_eq!(f.escrow.release_milestone(&0), M0);

    let d1 = digest(&f.env, 0x11);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);
    f.escrow.approve_milestone(&f.inspector, &1, &d1);
    f.escrow.approve_milestone(&f.buyer, &1, &d1);
    assert_eq!(f.escrow.release_milestone(&1), M1);

    let d2 = digest(&f.env, 0x12);
    f.escrow.anchor_evidence(&f.buyer, &2, &d2);
    f.escrow.approve_milestone(&f.buyer, &2, &d2);
    f.escrow.release_milestone(&2);

    let a = f.escrow.get_agreement();
    assert_eq!(a.status, AgreementStatus::Completed);
    assert_eq!(a.released, TOTAL);
    assert_eq!(f.token.balance(&f.supplier), TOTAL);
    assert_eq!(f.escrow.get_balance(), 0);
    assert_conservation(&f);
}

#[test]
fn replayed_release_transfers_nothing() {
    let f = funded();
    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    f.escrow.release_milestone(&0);
    let before = f.token.balance(&f.supplier);

    assert_eq!(f.escrow.try_release_milestone(&0), Err(Ok(Error::MilestoneNotOpen)));
    assert_eq!(f.token.balance(&f.supplier), before);
    assert_conservation(&f);
}

#[test]
fn release_before_acceptance_or_funding_reverts() {
    let f = setup();
    assert_eq!(f.escrow.try_release_milestone(&0), Err(Ok(Error::NotFullyFunded)));

    f.escrow.accept_terms(&f.buyer, &f.terms);
    f.escrow.accept_terms(&f.supplier, &f.terms);
    f.escrow.fund(&f.buyer, &f.token.address, &(TOTAL / 2));
    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    assert_eq!(f.escrow.try_release_milestone(&0), Err(Ok(Error::NotFullyFunded)));
    assert_eq!(f.token.balance(&f.escrow.address), TOTAL / 2);
}

#[test]
fn accept_terms_requires_exact_digest_and_party() {
    let f = setup();
    assert_eq!(
        f.escrow.try_accept_terms(&f.buyer, &digest(&f.env, 0xBB)),
        Err(Ok(Error::TermsDigestMismatch))
    );
    assert_eq!(f.escrow.try_accept_terms(&f.inspector, &f.terms), Err(Ok(Error::NotParty)));
    f.escrow.accept_terms(&f.buyer, &f.terms);
    assert_eq!(f.escrow.get_agreement().status, AgreementStatus::AwaitingAcceptance);
    assert_eq!(f.escrow.try_fund(&f.buyer, &f.token.address, &TOTAL), Err(Ok(Error::WrongStatus)));
}

#[test]
fn funding_with_wrong_token_reverts() {
    let f = accepted();
    let other = f.env.register_stellar_asset_contract_v2(Address::generate(&f.env));
    StellarAssetClient::new(&f.env, &other.address()).mint(&f.buyer, &TOTAL);

    assert_eq!(f.escrow.try_fund(&f.buyer, &other.address(), &TOTAL), Err(Ok(Error::TokenMismatch)));
    assert_eq!(f.token.balance(&f.escrow.address), 0);
    assert_eq!(TokenClient::new(&f.env, &other.address()).balance(&f.escrow.address), 0);
}

#[test]
fn funding_rejects_zero_negative_and_overfunding() {
    let f = accepted();
    assert_eq!(f.escrow.try_fund(&f.buyer, &f.token.address, &0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(f.escrow.try_fund(&f.buyer, &f.token.address, &-5), Err(Ok(Error::InvalidAmount)));
    assert_eq!(f.escrow.try_fund(&f.buyer, &f.token.address, &(TOTAL + 1)), Err(Ok(Error::OverFunded)));
    assert_eq!(f.escrow.try_fund(&f.supplier, &f.token.address, &TOTAL), Err(Ok(Error::NotParty)));
}

#[test]
fn approval_of_superseded_evidence_does_not_count() {
    let f = funded();
    let original = digest(&f.env, 0x20);
    let altered = digest(&f.env, 0x21);
    f.escrow.anchor_evidence(&f.supplier, &1, &original);
    f.escrow.approve_milestone(&f.buyer, &1, &original);
    f.escrow.approve_milestone(&f.inspector, &1, &original);

    f.escrow.anchor_evidence(&f.supplier, &1, &altered);
    assert_eq!(f.escrow.get_approvals(&1).len(), 0);
    assert_eq!(f.escrow.try_release_milestone(&1), Err(Ok(Error::QuorumNotMet)));
    assert_eq!(
        f.escrow.try_approve_milestone(&f.buyer, &1, &original),
        Err(Ok(Error::EvidenceDigestMismatch))
    );
}

#[test]
fn missing_quorum_cannot_release() {
    let f = funded();
    let d1 = digest(&f.env, 0x11);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);
    f.escrow.approve_milestone(&f.buyer, &1, &d1);
    assert_eq!(f.escrow.try_release_milestone(&1), Err(Ok(Error::QuorumNotMet)));
    assert_eq!(f.token.balance(&f.escrow.address), TOTAL);
}

#[test]
fn release_without_evidence_reverts() {
    let f = funded();
    assert_eq!(f.escrow.try_release_milestone(&0), Err(Ok(Error::EvidenceNotAnchored)));
    assert_eq!(f.escrow.try_release_milestone(&9), Err(Ok(Error::UnknownMilestone)));
}

#[test]
fn unappointed_signer_cannot_approve() {
    let f = funded();
    let d1 = digest(&f.env, 0x11);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);
    let stranger = Address::generate(&f.env);
    assert_eq!(f.escrow.try_approve_milestone(&stranger, &1, &d1), Err(Ok(Error::NotAppointedApprover)));
    assert_eq!(f.escrow.try_approve_milestone(&f.supplier, &1, &d1), Err(Ok(Error::NotAppointedApprover)));
    assert_eq!(f.escrow.try_anchor_evidence(&stranger, &1, &d1), Err(Ok(Error::NotParty)));
}

#[test]
fn revoked_approval_drops_below_quorum() {
    let f = funded();
    let d1 = digest(&f.env, 0x11);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);
    f.escrow.approve_milestone(&f.buyer, &1, &d1);
    f.escrow.approve_milestone(&f.inspector, &1, &d1);
    f.escrow.revoke_approval(&f.inspector, &1);
    assert_eq!(f.escrow.try_release_milestone(&1), Err(Ok(Error::QuorumNotMet)));
    assert_eq!(f.escrow.try_revoke_approval(&f.inspector, &1), Err(Ok(Error::ApprovalNotFound)));
}

#[test]
fn dispute_freezes_only_the_disputed_milestone() {
    let f = funded();
    let d1 = digest(&f.env, 0x11);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);
    f.escrow.approve_milestone(&f.buyer, &1, &d1);
    f.escrow.approve_milestone(&f.inspector, &1, &d1);
    f.escrow.open_dispute(&f.buyer, &1, &digest(&f.env, 0xD1));

    assert_eq!(f.escrow.try_release_milestone(&1), Err(Ok(Error::MilestoneDisputed)));
    assert_eq!(f.escrow.get_milestone(&1).status, MilestoneStatus::Disputed);
    assert_eq!(f.escrow.try_approve_milestone(&f.buyer, &1, &d1), Err(Ok(Error::MilestoneNotOpen)));

    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    f.escrow.release_milestone(&0);
    assert_conservation(&f);
}

#[test]
fn released_milestone_cannot_be_disputed() {
    let f = funded();
    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    f.escrow.release_milestone(&0);
    assert_eq!(
        f.escrow.try_open_dispute(&f.buyer, &0, &digest(&f.env, 0xD1)),
        Err(Ok(Error::MilestoneNotOpen))
    );
    assert_eq!(
        f.escrow.try_open_dispute(&f.inspector, &1, &digest(&f.env, 0xD1)),
        Err(Ok(Error::NotParty))
    );
}

#[test]
fn resolver_split_must_equal_milestone_amount() {
    let f = funded();
    f.escrow.open_dispute(&f.supplier, &1, &digest(&f.env, 0xD1));

    let over = Resolution { to_buyer: M1, to_payee: 1 };
    assert_eq!(f.escrow.try_resolve_dispute(&f.resolver, &1, &over), Err(Ok(Error::AllocationMismatch)));
    let under = Resolution { to_buyer: 1, to_payee: 1 };
    assert_eq!(f.escrow.try_resolve_dispute(&f.resolver, &1, &under), Err(Ok(Error::AllocationMismatch)));
    let negative = Resolution { to_buyer: -1, to_payee: M1 + 1 };
    assert_eq!(f.escrow.try_resolve_dispute(&f.resolver, &1, &negative), Err(Ok(Error::InvalidAmount)));

    let buyer_before = f.token.balance(&f.buyer);
    let split = Resolution { to_buyer: 30_000_0000000, to_payee: M1 - 30_000_0000000 };
    f.escrow.resolve_dispute(&f.resolver, &1, &split);
    assert_eq!(f.token.balance(&f.buyer) - buyer_before, 30_000_0000000);
    assert_eq!(f.token.balance(&f.supplier), M1 - 30_000_0000000);
    assert_eq!(f.escrow.get_milestone(&1).status, MilestoneStatus::Resolved);
    assert_eq!(
        f.escrow.try_resolve_dispute(&f.resolver, &1, &split),
        Err(Ok(Error::WrongStatus))
    );
    assert_conservation(&f);
}

#[test]
fn only_named_resolver_can_resolve_and_platform_has_no_override() {
    let f = funded();
    f.escrow.open_dispute(&f.buyer, &1, &digest(&f.env, 0xD1));
    let split = Resolution { to_buyer: M1, to_payee: 0 };
    let platform = Address::generate(&f.env);
    assert_eq!(f.escrow.try_resolve_dispute(&platform, &1, &split), Err(Ok(Error::NotResolver)));
    assert_eq!(f.escrow.try_resolve_dispute(&f.buyer, &1, &split), Err(Ok(Error::NotResolver)));
    assert_eq!(f.escrow.try_resolve_dispute(&f.resolver, &0, &split), Err(Ok(Error::WrongStatus)));
}

#[test]
fn refund_only_after_declared_deadline() {
    let f = funded();
    assert_eq!(f.escrow.try_refund_expired(&2), Err(Ok(Error::RefundNotDue)));
    assert_eq!(f.escrow.try_refund_expired(&1), Err(Ok(Error::RefundNotDue)));

    f.env.ledger().set_timestamp(REFUND_AFTER);
    let before = f.token.balance(&f.buyer);
    assert_eq!(f.escrow.refund_expired(&2), M2);
    assert_eq!(f.token.balance(&f.buyer) - before, M2);
    assert_eq!(f.escrow.try_refund_expired(&2), Err(Ok(Error::MilestoneNotOpen)));
    assert_conservation(&f);
}

#[test]
fn disputed_milestone_cannot_be_refunded_by_timeout() {
    let f = funded();
    f.escrow.open_dispute(&f.supplier, &2, &digest(&f.env, 0xD2));
    f.env.ledger().set_timestamp(REFUND_AFTER + 1);
    assert_eq!(f.escrow.try_refund_expired(&2), Err(Ok(Error::MilestoneDisputed)));
}

#[test]
fn cancel_unfunded_rules() {
    let f = accepted();
    f.escrow.fund(&f.buyer, &f.token.address, &1_0000000);
    assert_eq!(f.escrow.try_cancel_unfunded(&f.supplier), Err(Ok(Error::CancelNotAllowed)));

    f.env.ledger().set_timestamp(FUNDING_DEADLINE);
    let before = f.token.balance(&f.buyer);
    f.escrow.cancel_unfunded(&f.supplier);
    assert_eq!(f.token.balance(&f.buyer) - before, 1_0000000);
    assert_eq!(f.escrow.get_agreement().status, AgreementStatus::Cancelled);
    assert_conservation(&f);

    let g = funded();
    assert_eq!(g.escrow.try_cancel_unfunded(&g.buyer), Err(Ok(Error::CancelNotAllowed)));
}

#[test]
fn cancel_before_any_funding_is_immediate() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(f.escrow.try_cancel_unfunded(&stranger), Err(Ok(Error::NotParty)));
    f.escrow.cancel_unfunded(&f.buyer);
    assert_eq!(f.escrow.get_agreement().status, AgreementStatus::Cancelled);
    assert_eq!(f.escrow.try_accept_terms(&f.supplier, &f.terms), Err(Ok(Error::WrongStatus)));
}

#[test]
fn mixed_settlement_paths_conserve_funds() {
    let f = funded();
    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    f.escrow.release_milestone(&0);

    f.escrow.open_dispute(&f.buyer, &1, &digest(&f.env, 0xD1));
    f.escrow.resolve_dispute(&f.resolver, &1, &Resolution { to_buyer: M1 / 2, to_payee: M1 / 2 });

    f.env.ledger().set_timestamp(REFUND_AFTER);
    f.escrow.refund_expired(&2);

    let a = f.escrow.get_agreement();
    assert_eq!(a.status, AgreementStatus::Completed);
    assert_eq!(a.released, M0 + M1 / 2);
    assert_eq!(a.refunded, M1 / 2 + M2);
    assert_eq!(f.token.balance(&f.buyer), TOTAL * 2 - TOTAL + a.refunded);
    assert_conservation(&f);
}

#[test]
fn approve_requires_signer_authorization() {
    let f = funded();
    let d1 = digest(&f.env, 0x11);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);

    f.env.set_auths(&[]);
    assert!(f.escrow.try_approve_milestone(&f.inspector, &1, &d1).is_err());

    f.env.mock_auths(&[MockAuth {
        address: &f.inspector,
        invoke: &MockAuthInvoke {
            contract: &f.escrow.address,
            fn_name: "approve_milestone",
            args: (&f.inspector, 1u32, &d1).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    f.escrow.approve_milestone(&f.inspector, &1, &d1);
    assert_eq!(f.escrow.get_approvals(&1).len(), 1);
}

#[test]
fn approval_signature_is_bound_to_its_digest() {
    let f = funded();
    let d1 = digest(&f.env, 0x11);
    let other = digest(&f.env, 0x99);
    f.escrow.anchor_evidence(&f.supplier, &1, &d1);

    f.env.mock_auths(&[MockAuth {
        address: &f.inspector,
        invoke: &MockAuthInvoke {
            contract: &f.escrow.address,
            fn_name: "approve_milestone",
            args: (&f.inspector, 1u32, &other).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f.escrow.try_approve_milestone(&f.inspector, &1, &d1).is_err());
}

#[test]
fn fund_requires_buyer_authorization() {
    let f = accepted();
    f.env.set_auths(&[]);
    assert!(f.escrow.try_fund(&f.buyer, &f.token.address, &TOTAL).is_err());
    assert_eq!(f.token.balance(&f.escrow.address), 0);
}

#[test]
fn release_is_permissionless_but_needs_no_privileged_auth() {
    let f = funded();
    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    f.env.set_auths(&[]);
    f.escrow.release_milestone(&0);
    assert_eq!(f.token.balance(&f.supplier), M0);
}

#[test]
fn invalid_policies_are_rejected_at_deployment() {
    let env = Env::default();
    let buyer = Address::generate(&env);
    let supplier = Address::generate(&env);
    let resolver = Address::generate(&env);
    let token = Address::generate(&env);
    let d = BytesN::from_array(&env, &[1; 32]);

    let deploy = |p: AgreementPolicy, b: &Address, s: &Address| {
        let env = env.clone();
        let (d, token) = (d.clone(), token.clone());
        let (b, s) = (b.clone(), s.clone());
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            env.register(TradeEscrow, (d.clone(), b, s, token, d, p));
        }))
        .is_err()
    };
    let spec = |amount: i128, approvers: soroban_sdk::Vec<Address>, quorum: u32| MilestoneSpec {
        amount,
        payee: supplier.clone(),
        approvers,
        quorum,
        refund_after: 0,
    };
    let with = |m: MilestoneSpec| AgreementPolicy {
        milestones: vec![&env, m],
        resolver: resolver.clone(),
        funding_deadline: 0,
    };

    assert!(deploy(with(spec(0, vec![&env, buyer.clone()], 1)), &buyer, &supplier));
    assert!(deploy(with(spec(10, vec![&env, buyer.clone()], 2)), &buyer, &supplier));
    assert!(deploy(with(spec(10, vec![&env, buyer.clone()], 0)), &buyer, &supplier));
    assert!(deploy(with(spec(10, vec![&env], 0)), &buyer, &supplier));
    assert!(deploy(with(spec(10, vec![&env, buyer.clone(), buyer.clone()], 2)), &buyer, &supplier));
    assert!(deploy(with(spec(10, vec![&env, buyer.clone()], 1)), &buyer, &buyer));
    assert!(deploy(
        AgreementPolicy { milestones: vec![&env], resolver: resolver.clone(), funding_deadline: 0 },
        &buyer,
        &supplier
    ));
}

#[test]
fn critical_state_survives_long_inactivity_with_ttl_maintenance() {
    let f = funded();
    let key_ttl = |f: &Fixture| {
        f.env.as_contract(&f.escrow.address, || {
            f.env.storage().persistent().get_ttl(&crate::DataKey::Agreement)
        })
    };
    let initial = key_ttl(&f);
    assert!(initial > 0);

    let seq = f.env.ledger().sequence();
    f.env.ledger().set_sequence_number(seq + initial - 10);
    f.escrow.extend_ttl();
    assert!(key_ttl(&f) > 10);
    assert_eq!(f.escrow.get_agreement().funded, TOTAL);
}

#[test]
fn events_cover_the_money_path() {
    let f = funded();
    let d0 = digest(&f.env, 0x10);
    f.escrow.anchor_evidence(&f.supplier, &0, &d0);
    f.escrow.approve_milestone(&f.buyer, &0, &d0);
    f.escrow.release_milestone(&0);
    let events = f.env.events().all();
    assert!(!events.events().is_empty());
}
