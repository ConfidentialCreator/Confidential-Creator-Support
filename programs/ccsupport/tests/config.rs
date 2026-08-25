mod common;

use anchor_lang::{AccountDeserialize, Space};
use ccsupport::errors::CcsError;
use ccsupport::state::{Config, Creator, Handle, Pledge};
use common::{
    config_setup, init_config, init_config_accounts, mint_account, Harness, TOKEN_LEGACY,
};
use mollusk_svm::result::Check;

#[test]
fn init_config_stores_mint_authority_and_bump() {
    let s = config_setup();
    let mut h = Harness::new();
    let result = h.process(
        &init_config(&s),
        &init_config_accounts(&s),
        &[Check::success()],
    );

    let stored = result.get_account(&s.config).unwrap();
    assert_eq!(stored.owner, ccsupport::ID);
    assert_eq!(stored.data.len(), 8 + Config::INIT_SPACE);
    let config = Config::try_deserialize(&mut stored.data.as_slice()).unwrap();
    assert_eq!(config.mint, s.mint);
    assert_eq!(config.authority, s.authority);
    assert_eq!(config.bump, s.bump);
}

#[test]
fn init_config_runs_only_once() {
    let s = config_setup();
    let mut h = Harness::new();
    let first = h.process(
        &init_config(&s),
        &init_config_accounts(&s),
        &[Check::success()],
    );
    let existing = first.get_account(&s.config).unwrap().clone();

    let other = config_setup();
    let mut accounts = init_config_accounts(&other);
    accounts[0] = (s.config, existing);
    let second = h.process(&init_config(&other), &accounts, &[]);
    assert!(second.raw_result.is_err());
}

#[test]
fn init_config_rejects_a_mint_outside_token_2022() {
    let s = config_setup();
    let mut h = Harness::new();
    let mut accounts = init_config_accounts(&s);
    accounts[2] = (s.mint, mint_account(TOKEN_LEGACY));
    let result = h.process(&init_config(&s), &accounts, &[]);
    assert!(result.raw_result.is_err());
    assert!(h
        .logs()
        .iter()
        .any(|l| l.contains("ConstraintMintTokenProgram")));
}

#[test]
fn init_config_rejects_an_unsigned_authority() {
    let s = config_setup();
    let mut h = Harness::new();
    let mut ix = init_config(&s);
    ix.accounts[1].is_signer = false;
    let result = h.process(&ix, &init_config_accounts(&s), &[]);
    assert!(result.raw_result.is_err());
}

#[test]
fn state_sizes_and_seeds_match_the_plan() {
    assert_eq!(Config::SEED, b"config");
    assert_eq!(Creator::SEED, b"creator");
    assert_eq!(Handle::SEED, b"handle");
    assert_eq!(Pledge::SEED, b"pledge");

    assert_eq!(Config::INIT_SPACE, 32 + 32 + 1);
    assert_eq!(
        Creator::INIT_SPACE,
        32 + 32 + (4 + 64) + (4 + 256) + 8 + 8 + 8 + 1
    );
    assert_eq!(Handle::INIT_SPACE, 32 + 1);
    assert_eq!(Pledge::INIT_SPACE, 32 + 32 + 8 + 8 + 4 + 4 + 1 + 8 + 1);
}

#[test]
fn error_codes_are_stable_from_the_anchor_custom_base() {
    assert_eq!(u32::from(CcsError::HandleTaken), 6000);
    assert_eq!(u32::from(CcsError::InvalidHandle), 6001);
    assert_eq!(u32::from(CcsError::NameTooLong), 6002);
    assert_eq!(u32::from(CcsError::DescriptionTooLong), 6003);
    assert_eq!(u32::from(CcsError::TransferNotFound), 6004);
    assert_eq!(u32::from(CcsError::WrongMint), 6005);
    assert_eq!(u32::from(CcsError::WrongDestination), 6006);
    assert_eq!(u32::from(CcsError::WrongAuthority), 6007);
    assert_eq!(u32::from(CcsError::InvalidPeriods), 6008);
    assert_eq!(u32::from(CcsError::WrongSource), 6009);
}
