mod common;

use common::pledge_setup;
use solana_pubkey::Pubkey;

// `packages/chain/src/pda.ts` derives the same addresses; the fixture keeps both
// sides on the same seeds.
const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/pda.json");

fn key(v: &serde_json::Value) -> Pubkey {
    v.as_str().unwrap().parse().unwrap()
}

fn bump(v: &serde_json::Value) -> u8 {
    u8::try_from(v.as_u64().unwrap()).unwrap()
}

#[test]
fn program_pdas_match_the_shared_fixture() {
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap();
    let s = pledge_setup();

    assert_eq!(key(&json["program"]), ccsupport::ID);
    assert_eq!(key(&json["config"]["address"]), s.config.config);
    assert_eq!(bump(&json["config"]["bump"]), s.config.bump);
    assert_eq!(key(&json["creator"]["wallet"]), s.creator.wallet);
    assert_eq!(key(&json["creator"]["address"]), s.creator.creator);
    assert_eq!(bump(&json["creator"]["bump"]), s.creator.creator_bump);
    assert_eq!(json["handle"]["handle"].as_str().unwrap(), s.creator.handle);
    assert_eq!(key(&json["handle"]["address"]), s.creator.handle_account);
    assert_eq!(bump(&json["handle"]["bump"]), s.creator.handle_bump);
    assert_eq!(key(&json["pledge"]["creatorWallet"]), s.creator.wallet);
    assert_eq!(key(&json["pledge"]["supporter"]), s.supporter);
    assert_eq!(key(&json["pledge"]["address"]), s.pledge);
    assert_eq!(bump(&json["pledge"]["bump"]), s.pledge_bump);
}
