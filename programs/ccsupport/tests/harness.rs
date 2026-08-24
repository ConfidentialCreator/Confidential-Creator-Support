mod common;

use anchor_lang::prelude::AccountInfo;
use common::{
    config_setup, fixture_transfer, init_config, init_config_accounts, instructions_sysvar,
    Harness, TOKEN_2022,
};
use mollusk_svm::result::Check;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

#[test]
fn pubkey_types_are_one() {
    let anchor: anchor_lang::prelude::Pubkey = ccsupport::ID;
    let mollusk: solana_pubkey::Pubkey = anchor;
    assert_eq!(
        mollusk.to_string(),
        "8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z"
    );
}

#[test]
fn runs_the_deployed_elf() {
    let mut h = Harness::new();
    let s = config_setup();
    let result = h.process(
        &init_config(&s),
        &init_config_accounts(&s),
        &[Check::success()],
    );
    assert!(result.compute_units_consumed > 0);
    assert!(h
        .logs()
        .iter()
        .any(|l| l.contains("Instruction: InitConfig")));
}

#[test]
fn warp_sets_slot_and_unix_timestamp_together() {
    let mut h = Harness::new();
    h.warp(1_000, 1_800_000_000);
    assert_eq!(h.mollusk.sysvars.clock.slot, 1_000);
    assert_eq!(h.mollusk.sysvars.clock.unix_timestamp, 1_800_000_000);

    h.warp(2_000, 1_800_000_400);
    assert_eq!(h.mollusk.sysvars.clock.slot, 2_000);
    assert_eq!(h.mollusk.sysvars.clock.unix_timestamp, 1_800_000_400);
}

#[test]
fn logs_hold_only_the_current_run() {
    let mut h = Harness::new();
    let s = config_setup();
    let ix = init_config(&s);
    let accounts = init_config_accounts(&s);
    h.process(&ix, &accounts, &[Check::success()]);
    let first = h.logs();
    assert!(first.iter().any(|l| l.contains("Instruction: InitConfig")));

    for run in 1..200 {
        h.process(&ix, &accounts, &[Check::success()]);
        let logs = h.logs();
        assert_eq!(logs, first, "run {run}: logs differ from the first run");
    }
}

#[test]
fn fixture_transfer_is_token_2022_confidential_transfer() {
    let ix = fixture_transfer();
    assert_eq!(ix.program_id, TOKEN_2022);
    assert_eq!(&ix.data[..2], &[27, 7]);
    assert_eq!(ix.accounts.len(), 7);

    let key = |s: &str| s.parse::<solana_pubkey::Pubkey>().unwrap();
    assert_eq!(
        ix.accounts[0].pubkey,
        key("GtQ3RJYrsnUSUHh7bMUqAFMbdZ6kNz92WFFNAf1uQ8ac")
    );
    assert_eq!(
        ix.accounts[1].pubkey,
        key("6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC")
    );
    assert_eq!(
        ix.accounts[2].pubkey,
        key("6hSuKztYGDo1sT98WB9LvxeHBkA58kzQrT2rJZhEbJ7q")
    );
    assert_eq!(
        ix.accounts[6].pubkey,
        key("6BUPsnbo6yqeUE5UHHz6WDp6b4saTf3PPEn5B2Mp7JGZ")
    );

    assert!(ix.accounts[0].is_writable && !ix.accounts[0].is_signer);
    assert!(!ix.accounts[1].is_writable);
    assert!(ix.accounts[2].is_writable);
    assert!(ix.accounts[6].is_signer && ix.accounts[6].is_writable);
}

#[test]
fn instructions_sysvar_round_trips_through_the_program_side_reader() {
    let transfer = fixture_transfer();
    let (key, mut account) =
        instructions_sysvar(&[transfer.clone(), init_config(&config_setup())], 1);
    assert_eq!(key, solana_instructions_sysvar::ID);

    let mut lamports = account.lamports;
    let info = AccountInfo::new(
        &key,
        false,
        false,
        &mut lamports,
        &mut account.data,
        &account.owner,
        false,
    );

    assert_eq!(load_current_index_checked(&info).unwrap(), 1);

    let loaded = load_instruction_at_checked(0, &info).unwrap();
    assert_eq!(loaded, transfer);

    let own = load_instruction_at_checked(1, &info).unwrap();
    assert_eq!(own.program_id, ccsupport::ID);
    assert!(load_instruction_at_checked(2, &info).is_err());
}
