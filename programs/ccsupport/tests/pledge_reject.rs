mod common;

use common::{
    bootstrap, fixture_transfer, instructions_sysvar, pledge, pledge_accounts, pledge_setup,
    Harness, PledgeSetup, PledgeState, TOKEN_LEGACY,
};
use mollusk_svm::result::InstructionResult;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

// Positions from the CT transfer layout in the T006 fixture: source, mint, destination, …,
// authority last.
const SOURCE: usize = 0;
const MINT: usize = 1;
const DESTINATION: usize = 2;

const TRANSFER_NOT_FOUND: &str = "Custom(6004)";
const WRONG_MINT: &str = "Custom(6005)";
const WRONG_DESTINATION: &str = "Custom(6006)";
const WRONG_AUTHORITY: &str = "Custom(6007)";
const INVALID_PERIODS: &str = "Custom(6008)";
const WRONG_SOURCE: &str = "Custom(6009)";
const CONSTRAINT_SEEDS: &str = "Custom(2006)";

fn raw(result: &InstructionResult) -> String {
    format!("{:?}", result.raw_result)
}

fn transfer_with(index: usize, pubkey: Pubkey) -> Instruction {
    let mut transfer = fixture_transfer();
    transfer.accounts[index].pubkey = pubkey;
    transfer
}

fn transfer_with_authority(pubkey: Pubkey, is_signer: bool) -> Instruction {
    let mut transfer = fixture_transfer();
    let authority = transfer.accounts.last_mut().unwrap();
    authority.pubkey = pubkey;
    authority.is_signer = is_signer;
    transfer
}

fn attempt(
    h: &mut Harness,
    s: &PledgeSetup,
    state: &PledgeState,
    transfer: &Instruction,
    periods: u8,
) -> InstructionResult {
    let ix = pledge(s, periods, true);
    h.process(&ix, &pledge_accounts(s, state, transfer, &ix), &[])
}

fn assert_rejected(result: &InstructionResult, s: &PledgeSetup, code: &str) {
    assert!(raw(result).contains(code), "{}", raw(result));
    assert!(
        result.get_account(&s.pledge).unwrap().data.is_empty(),
        "no Pledge record should appear"
    );
    assert_eq!(
        result.get_account(&s.pledge).unwrap().lamports,
        0,
        "no rent should be charged"
    );
}

#[test]
fn without_a_transfer_in_the_transaction_there_is_no_pledge() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let ix = pledge(&s, 1, true);
    let mut accounts = pledge_accounts(&s, &state, &fixture_transfer(), &ix);
    accounts[4] = instructions_sysvar(std::slice::from_ref(&ix), 0);
    let result = h.process(&ix, &accounts, &[]);

    assert_rejected(&result, &s, TRANSFER_NOT_FOUND);
}

#[test]
fn a_transfer_under_the_legacy_token_program_does_not_count() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let mut transfer = fixture_transfer();
    transfer.program_id = TOKEN_LEGACY;
    let result = attempt(&mut h, &s, &state, &transfer, 1);

    assert_rejected(&result, &s, TRANSFER_NOT_FOUND);
}

#[test]
fn a_transfer_to_another_creator_is_rejected() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let transfer = transfer_with(DESTINATION, Pubkey::new_unique());
    let result = attempt(&mut h, &s, &state, &transfer, 1);

    assert_rejected(&result, &s, WRONG_DESTINATION);
}

#[test]
fn a_transfer_in_another_mint_is_rejected() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let transfer = transfer_with(MINT, Pubkey::new_unique());
    let result = attempt(&mut h, &s, &state, &transfer, 1);

    assert_rejected(&result, &s, WRONG_MINT);
}

#[test]
fn a_transfer_from_another_token_account_is_rejected() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let transfer = transfer_with(SOURCE, Pubkey::new_unique());
    let result = attempt(&mut h, &s, &state, &transfer, 1);

    assert_rejected(&result, &s, WRONG_SOURCE);
}

#[test]
fn a_transfer_authorised_by_someone_else_is_rejected() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let transfer = transfer_with_authority(Pubkey::new_unique(), true);
    let result = attempt(&mut h, &s, &state, &transfer, 1);

    assert_rejected(&result, &s, WRONG_AUTHORITY);
}

#[test]
fn a_transfer_whose_authority_did_not_sign_is_rejected() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let transfer = transfer_with_authority(s.supporter, false);
    let result = attempt(&mut h, &s, &state, &transfer, 1);

    assert_rejected(&result, &s, WRONG_AUTHORITY);
}

#[test]
fn periods_outside_1_to_12_are_rejected_even_with_a_real_transfer() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    for periods in [0, 13, u8::MAX] {
        let result = attempt(&mut h, &s, &state, &fixture_transfer(), periods);
        assert_rejected(&result, &s, INVALID_PERIODS);
    }
}

#[test]
fn a_config_off_the_canonical_pda_is_rejected_even_with_a_real_transfer() {
    let mut s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    // The same layout and the same mint, only the address is not from `find_program_address`.
    s.config.config = Pubkey::new_unique();
    let result = attempt(&mut h, &s, &state, &fixture_transfer(), 1);

    assert_rejected(&result, &s, CONSTRAINT_SEEDS);
}

#[test]
fn a_rejected_pledge_leaves_the_creator_counter_untouched() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    let result = attempt(
        &mut h,
        &s,
        &state,
        &transfer_with(DESTINATION, Pubkey::new_unique()),
        1,
    );

    assert_eq!(
        result.get_account(&s.creator.creator).unwrap().data,
        state.creator.data
    );
}
