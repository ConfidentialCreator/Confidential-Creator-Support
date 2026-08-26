mod common;

use common::{
    bootstrap, creator_setup_for, fixture_transfer, pledge, pledge_accounts, pledge_setup,
    register_creator, register_creator_accounts, Harness,
};
use mollusk_svm::result::Check;
use solana_pubkey::Pubkey;

// Стеля = виміряне ×1,5, округлене вгору до 5 000. Ліміт мережі на транзакцію —
// 200 000 CU, а поруч із `pledge` у ній стоїть сам конфіденційний переказ.
const REGISTER_CREATOR_CU: u64 = 30_000;
const PLEDGE_CU: u64 = 35_000;

// Пошук bump у `find_program_address` коштує ~1 500 CU на спробу, тож
// випадковий гаманець дає різне число від прогону до прогону.
const WALLET: Pubkey = Pubkey::new_from_array([7; 32]);

#[test]
fn register_creator_stays_under_its_ceiling() {
    let s = creator_setup_for(WALLET, "marrow-dispatch");
    let mut h = Harness::new();
    let result = h.process(
        &register_creator(&s, "Ilse Marrow", "The Marrow Dispatch"),
        &register_creator_accounts(&s),
        &[Check::success()],
    );
    let cu = result.compute_units_consumed;
    println!("register_creator: {cu} CU (стеля {REGISTER_CREATOR_CU})");
    assert!(cu <= REGISTER_CREATOR_CU, "register_creator: {cu} CU");
}

#[test]
fn pledge_stays_under_its_ceiling_on_the_first_and_repeat_contribution() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);
    h.warp(100, 1_789_418_258);

    let ix = pledge(&s, 1, true);
    let first = h.process(
        &ix,
        &pledge_accounts(&s, &state, &fixture_transfer(), &ix),
        &[Check::success()],
    );
    let state = state.after(&first, &s);
    let ix = pledge(&s, 12, false);
    let renewal = h.process(
        &ix,
        &pledge_accounts(&s, &state, &fixture_transfer(), &ix),
        &[Check::success()],
    );

    let (first, renewal) = (first.compute_units_consumed, renewal.compute_units_consumed);
    println!("pledge: перший {first} CU, поновлення {renewal} CU (стеля {PLEDGE_CU})");
    assert!(first <= PLEDGE_CU, "pledge (перший): {first} CU");
    assert!(renewal <= PLEDGE_CU, "pledge (поновлення): {renewal} CU");
}
