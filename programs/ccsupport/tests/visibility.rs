mod common;

use anchor_lang::AccountDeserialize;
use ccsupport::events::VisibilityChanged;
use ccsupport::state::Pledge;
use common::{
    bootstrap, events, fixture_transfer, pledge, pledge_accounts, pledge_setup, set_visibility,
    set_visibility_accounts, signer_account, Harness, PledgeSetup, PledgeState,
};
use mollusk_svm::result::{Check, InstructionResult};
use solana_account::Account;
use solana_pubkey::Pubkey;

const NOW: i64 = 1_789_418_258;

fn raw(result: &InstructionResult) -> String {
    format!("{:?}", result.raw_result)
}

fn pledge_of_account(account: &Account) -> Pledge {
    Pledge::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn pledge_of(result: &InstructionResult, s: &PledgeSetup) -> Pledge {
    pledge_of_account(result.get_account(&s.pledge).unwrap())
}

// A pledge made with `show_publicly = true` at NOW, slot 100 — the state that `set_visibility` edits.
fn pledged(h: &mut Harness, s: &PledgeSetup) -> PledgeState {
    let state = bootstrap(h, s);
    h.warp(100, NOW);
    let ix = pledge(s, 3, true);
    let result = h.process(
        &ix,
        &pledge_accounts(s, &state, &fixture_transfer(), &ix),
        &[Check::success()],
    );
    state.after(&result, s)
}

#[test]
fn the_supporter_hides_the_wallet_without_a_payment() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = pledged(&mut h, &s);
    let before = pledge_of_account(&state.pledge);

    h.warp(250, NOW + 86_400);
    let result = h.process(
        &set_visibility(&s, false),
        &set_visibility_accounts(&s, &state),
        &[Check::success()],
    );

    let p = pledge_of(&result, &s);
    assert!(!p.show_publicly);
    assert_eq!(p.creator, before.creator);
    assert_eq!(p.supporter, before.supporter);
    assert_eq!(p.started_at, before.started_at);
    assert_eq!(p.expires_at, before.expires_at);
    assert_eq!(p.periods_total, before.periods_total);
    assert_eq!(p.contributions, before.contributions);
    assert_eq!(
        p.last_slot, before.last_slot,
        "not a contribution: last_slot stays"
    );
    assert_eq!(p.bump, before.bump);
    assert_eq!(
        result.get_account(&s.pledge).unwrap().lamports,
        state.pledge.lamports,
        "no rent or fee moves"
    );
    assert_eq!(
        result.get_account(&s.supporter).unwrap().lamports,
        signer_account().lamports
    );

    let mut emitted = events::<VisibilityChanged>(&h.logs());
    assert_eq!(emitted.len(), 1);
    let e = emitted.pop().unwrap();
    assert_eq!(e.creator, s.creator.wallet);
    assert_eq!(e.supporter, s.supporter);
    assert!(!e.show_publicly);
    assert_eq!(e.slot, 250);
}

#[test]
fn setting_the_flag_to_its_current_value_still_succeeds_and_emits() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = pledged(&mut h, &s);

    let result = h.process(
        &set_visibility(&s, true),
        &set_visibility_accounts(&s, &state),
        &[Check::success()],
    );

    assert!(pledge_of(&result, &s).show_publicly);
    let emitted = events::<VisibilityChanged>(&h.logs());
    assert_eq!(emitted.len(), 1);
    assert!(emitted[0].show_publicly);
}

#[test]
fn the_flag_can_be_turned_back_on() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = pledged(&mut h, &s);

    let hidden = h.process(
        &set_visibility(&s, false),
        &set_visibility_accounts(&s, &state),
        &[Check::success()],
    );
    let state = PledgeState {
        pledge: hidden.get_account(&s.pledge).unwrap().clone(),
        ..state
    };
    let shown = h.process(
        &set_visibility(&s, true),
        &set_visibility_accounts(&s, &state),
        &[Check::success()],
    );

    assert!(pledge_of(&shown, &s).show_publicly);
}

#[test]
fn a_foreign_signer_is_rejected_and_the_pledge_is_untouched() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = pledged(&mut h, &s);

    let mut intruder = pledge_setup();
    intruder.supporter = Pubkey::new_unique();
    let result = h.process(
        &set_visibility(&intruder, false),
        &set_visibility_accounts(&intruder, &state),
        &[],
    );

    assert!(raw(&result).contains("Custom(2006)"), "{}", raw(&result));
    assert!(h.logs().iter().any(|l| l.contains("ConstraintSeeds")));
    assert_eq!(
        result.get_account(&s.pledge).unwrap().data,
        state.pledge.data
    );
}

#[test]
fn the_supporter_signature_is_required() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = pledged(&mut h, &s);

    let mut ix = set_visibility(&s, false);
    ix.accounts[0].is_signer = false;
    let result = h.process(&ix, &set_visibility_accounts(&s, &state), &[]);

    assert!(result.raw_result.is_err());
    assert_eq!(
        result.get_account(&s.pledge).unwrap().data,
        state.pledge.data
    );
}

#[test]
fn without_a_pledge_there_is_nothing_to_change_and_nothing_is_created() {
    let s = pledge_setup();
    let mut h = Harness::new();

    let result = h.process(
        &set_visibility(&s, true),
        &[
            (s.supporter, signer_account()),
            (s.pledge, Account::default()),
        ],
        &[],
    );

    assert!(result.raw_result.is_err());
    let account = result.get_account(&s.pledge).unwrap();
    assert!(account.data.is_empty());
    assert_eq!(account.lamports, 0);
}
