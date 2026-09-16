mod common;

use anchor_lang::prelude::AccountInfo;
use ccsupport::introspect::{find_confidential_transfer, ExpectedTransfer};
use common::{config_setup, fixture_transfer, init_config, instructions_sysvar};
use solana_pubkey::Pubkey;

fn key(s: &str) -> Pubkey {
    s.parse().unwrap()
}

// Addresses come from the `context` of the `fixtures/tx/transfer.json` fixture (devnet, T006).
fn expected_from_fixture() -> ExpectedTransfer {
    ExpectedTransfer {
        mint: key("6f1QTLNPh59wM26CQx1pnJTUcE814H64JaABjARPvtiC"),
        source: key("GtQ3RJYrsnUSUHh7bMUqAFMbdZ6kNz92WFFNAf1uQ8ac"),
        destination: key("6hSuKztYGDo1sT98WB9LvxeHBkA58kzQrT2rJZhEbJ7q"),
        authority: key("6BUPsnbo6yqeUE5UHHz6WDp6b4saTf3PPEn5B2Mp7JGZ"),
    }
}

#[test]
fn the_real_devnet_transfer_next_to_our_instruction_is_found() {
    let (sysvar_key, mut account) =
        instructions_sysvar(&[fixture_transfer(), init_config(&config_setup())], 1);
    let mut lamports = account.lamports;
    let info = AccountInfo::new(
        &sysvar_key,
        false,
        false,
        &mut lamports,
        &mut account.data,
        &account.owner,
        false,
    );

    assert!(find_confidential_transfer(&info, &expected_from_fixture()).is_ok());

    let mut other_creator = expected_from_fixture();
    other_creator.destination = Pubkey::new_unique();
    let err = find_confidential_transfer(&info, &other_creator).unwrap_err();
    assert!(err.to_string().contains("WrongDestination"), "{err}");
}
