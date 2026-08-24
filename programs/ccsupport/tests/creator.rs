mod common;

use anchor_lang::{AccountDeserialize, Space};
use ccsupport::events::{CreatorRegistered, CreatorUpdated};
use ccsupport::state::{Creator, Handle};
use common::{
    creator_setup, events, register_creator, register_creator_accounts, signer_account,
    update_creator, CreatorSetup, Harness,
};
use mollusk_svm::result::{Check, InstructionResult};
use solana_account::Account;
use solana_pubkey::Pubkey;

const NAME: &str = "Ilse Marrow";
const DESCRIPTION: &str = "Independent reporting from the Marrow Dispatch.";

fn registered(h: &mut Harness, s: &CreatorSetup) -> InstructionResult {
    h.process(
        &register_creator(s, NAME, DESCRIPTION),
        &register_creator_accounts(s),
        &[Check::success()],
    )
}

fn raw(result: &InstructionResult) -> String {
    format!("{:?}", result.raw_result)
}

fn creator_of(result: &InstructionResult, key: &Pubkey) -> Creator {
    Creator::try_deserialize(&mut result.get_account(key).unwrap().data.as_slice()).unwrap()
}

fn update_accounts(s: &CreatorSetup, creator: Account) -> Vec<(Pubkey, Account)> {
    vec![(s.wallet, signer_account()), (s.creator, creator)]
}

#[test]
fn register_creator_writes_profile_handle_and_event() {
    let s = creator_setup("marrow-dispatch");
    let mut h = Harness::new();
    h.warp(4_200, 1_760_000_000);
    let result = registered(&mut h, &s);

    let creator_account = result.get_account(&s.creator).unwrap();
    assert_eq!(creator_account.owner, ccsupport::ID);
    assert_eq!(creator_account.data.len(), 8 + Creator::INIT_SPACE);
    let creator = creator_of(&result, &s.creator);
    assert_eq!(creator.wallet, s.wallet);
    let mut handle = [0u8; 32];
    handle[..15].copy_from_slice(b"marrow-dispatch");
    assert_eq!(creator.handle, handle);
    assert_eq!(creator.name, NAME);
    assert_eq!(creator.description, DESCRIPTION);
    assert_eq!(creator.suggested_amount, 0);
    assert_eq!(creator.pledges_total, 0);
    assert_eq!(creator.created_at, 1_760_000_000);
    assert_eq!(creator.bump, s.creator_bump);

    let handle_account = result.get_account(&s.handle_account).unwrap();
    assert_eq!(handle_account.owner, ccsupport::ID);
    assert_eq!(handle_account.data.len(), 8 + Handle::INIT_SPACE);
    let stored = Handle::try_deserialize(&mut handle_account.data.as_slice()).unwrap();
    assert_eq!(stored.creator, s.creator);
    assert_eq!(stored.bump, s.handle_bump);

    let emitted = events::<CreatorRegistered>(&h.logs());
    assert_eq!(emitted.len(), 1);
    let e = &emitted[0];
    assert_eq!(e.wallet, s.wallet);
    assert_eq!(e.handle, "marrow-dispatch");
    assert_eq!(e.name, NAME);
    assert_eq!(e.description, DESCRIPTION);
    assert_eq!(e.suggested_amount, 0);
    assert_eq!(e.slot, 4_200);
}

#[test]
fn register_creator_accepts_the_longest_allowed_fields() {
    let s = creator_setup(&"a".repeat(32));
    let mut h = Harness::new();
    let result = h.process(
        &register_creator(&s, &"n".repeat(64), &"d".repeat(256)),
        &register_creator_accounts(&s),
        &[Check::success()],
    );
    let creator = creator_of(&result, &s.creator);
    assert_eq!(creator.handle, [b'a'; 32]);
    assert_eq!(creator.name.len(), 64);
    assert_eq!(creator.description.len(), 256);
}

#[test]
fn one_wallet_gets_one_profile() {
    let first = creator_setup("first-handle");
    let mut h = Harness::new();
    let existing = registered(&mut h, &first)
        .get_account(&first.creator)
        .unwrap()
        .clone();

    let mut second = creator_setup("second-handle");
    second.wallet = first.wallet;
    second.creator = first.creator;
    let mut accounts = register_creator_accounts(&second);
    accounts[1] = (second.creator, existing);
    let result = h.process(
        &register_creator(&second, NAME, DESCRIPTION),
        &accounts,
        &[],
    );
    assert!(result.raw_result.is_err());
    assert!(h.logs().iter().any(|l| l.contains("already in use")));
}

#[test]
fn a_taken_handle_is_rejected_for_another_wallet() {
    let owner = creator_setup("marrow-dispatch");
    let mut h = Harness::new();
    let existing = registered(&mut h, &owner)
        .get_account(&owner.handle_account)
        .unwrap()
        .clone();

    let intruder = creator_setup("marrow-dispatch");
    assert_eq!(intruder.handle_account, owner.handle_account);
    let mut accounts = register_creator_accounts(&intruder);
    accounts[2] = (intruder.handle_account, existing);
    let result = h.process(
        &register_creator(&intruder, NAME, DESCRIPTION),
        &accounts,
        &[],
    );
    assert!(result.raw_result.is_err());
    assert!(h.logs().iter().any(|l| l.contains("already in use")));
    assert!(result
        .get_account(&intruder.creator)
        .unwrap()
        .data
        .is_empty());
}

#[test]
fn an_invalid_handle_fails_with_invalid_handle_even_past_the_seed_limit() {
    let mut h = Harness::new();
    for bad in ["Marrow", "ab", "marrow_dispatch", &"a".repeat(33)] {
        // PDA — з усіченого seed, інструкція — з повним handle
        let mut s = creator_setup(&bad[..bad.len().min(32)]);
        s.handle = bad.to_string();
        let result = h.process(
            &register_creator(&s, NAME, DESCRIPTION),
            &register_creator_accounts(&s),
            &[],
        );
        assert!(
            raw(&result).contains("Custom(6001)"),
            "{bad:?}: {}",
            raw(&result)
        );
        assert!(result.get_account(&s.creator).unwrap().data.is_empty());
    }
}

#[test]
fn register_creator_rejects_long_name_and_description() {
    let s = creator_setup("marrow-dispatch");
    let mut h = Harness::new();

    let result = h.process(
        &register_creator(&s, &"n".repeat(65), DESCRIPTION),
        &register_creator_accounts(&s),
        &[],
    );
    assert!(raw(&result).contains("Custom(6002)"), "{}", raw(&result));

    let result = h.process(
        &register_creator(&s, NAME, &"d".repeat(257)),
        &register_creator_accounts(&s),
        &[],
    );
    assert!(raw(&result).contains("Custom(6003)"), "{}", raw(&result));
}

#[test]
fn register_creator_needs_the_wallet_signature() {
    let s = creator_setup("marrow-dispatch");
    let mut h = Harness::new();
    let mut ix = register_creator(&s, NAME, DESCRIPTION);
    ix.accounts[0].is_signer = false;
    let result = h.process(&ix, &register_creator_accounts(&s), &[]);
    assert!(result.raw_result.is_err());
}

#[test]
fn update_creator_replaces_profile_and_emits_event() {
    let s = creator_setup("marrow-dispatch");
    let mut h = Harness::new();
    h.warp(4_200, 1_760_000_000);
    let existing = registered(&mut h, &s)
        .get_account(&s.creator)
        .unwrap()
        .clone();

    h.warp(9_000, 1_760_500_000);
    let result = h.process(
        &update_creator(&s, "Ilse M.", "Now weekly.", 5_000_000),
        &update_accounts(&s, existing),
        &[Check::success()],
    );

    let creator = creator_of(&result, &s.creator);
    assert_eq!(creator.name, "Ilse M.");
    assert_eq!(creator.description, "Now weekly.");
    assert_eq!(creator.suggested_amount, 5_000_000);
    assert_eq!(creator.wallet, s.wallet);
    assert_eq!(&creator.handle[..15], b"marrow-dispatch");
    assert_eq!(creator.created_at, 1_760_000_000);
    assert_eq!(creator.pledges_total, 0);

    let emitted = events::<CreatorUpdated>(&h.logs());
    assert_eq!(emitted.len(), 1);
    let e = &emitted[0];
    assert_eq!(e.wallet, s.wallet);
    assert_eq!(e.handle, "marrow-dispatch");
    assert_eq!(e.name, "Ilse M.");
    assert_eq!(e.description, "Now weekly.");
    assert_eq!(e.suggested_amount, 5_000_000);
    assert_eq!(e.slot, 9_000);
}

#[test]
fn update_creator_rejects_a_foreign_wallet() {
    let s = creator_setup("marrow-dispatch");
    let mut h = Harness::new();
    let existing = registered(&mut h, &s)
        .get_account(&s.creator)
        .unwrap()
        .clone();

    let mut intruder = creator_setup("other");
    intruder.creator = s.creator;
    let result = h.process(
        &update_creator(&intruder, "Hijacked", DESCRIPTION, 0),
        &update_accounts(&intruder, existing.clone()),
        &[],
    );
    assert!(result.raw_result.is_err());
    assert!(h.logs().iter().any(|l| l.contains("ConstraintSeeds")));
    assert_eq!(result.get_account(&s.creator).unwrap().data, existing.data);
}

#[test]
fn update_creator_rejects_long_fields() {
    let s = creator_setup("marrow-dispatch");
    let mut h = Harness::new();
    let existing = registered(&mut h, &s)
        .get_account(&s.creator)
        .unwrap()
        .clone();

    let result = h.process(
        &update_creator(&s, &"n".repeat(65), DESCRIPTION, 0),
        &update_accounts(&s, existing.clone()),
        &[],
    );
    assert!(raw(&result).contains("Custom(6002)"), "{}", raw(&result));

    let result = h.process(
        &update_creator(&s, NAME, &"d".repeat(257), 0),
        &update_accounts(&s, existing),
        &[],
    );
    assert!(raw(&result).contains("Custom(6003)"), "{}", raw(&result));
}
