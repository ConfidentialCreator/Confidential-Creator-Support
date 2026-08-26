mod common;

use anchor_lang::{AccountDeserialize, Space};
use ccsupport::events::Pledged;
use ccsupport::periods::{GRACE_SECONDS, PERIOD_SECONDS};
use ccsupport::state::{Creator, Pledge};
use common::{
    bootstrap, events, fixture_transfer, pledge, pledge_accounts, pledge_setup, Harness,
    PledgeSetup, PledgeState,
};
use mollusk_svm::result::{Check, InstructionResult};

const NOW: i64 = 1_789_418_258;

fn contribute(
    h: &mut Harness,
    s: &PledgeSetup,
    state: &PledgeState,
    periods: u8,
    show_publicly: bool,
) -> InstructionResult {
    let ix = pledge(s, periods, show_publicly);
    h.process(
        &ix,
        &pledge_accounts(s, state, &fixture_transfer(), &ix),
        &[Check::success()],
    )
}

fn pledge_of(result: &InstructionResult, s: &PledgeSetup) -> Pledge {
    Pledge::try_deserialize(&mut result.get_account(&s.pledge).unwrap().data.as_slice()).unwrap()
}

fn creator_of(result: &InstructionResult, s: &PledgeSetup) -> Creator {
    Creator::try_deserialize(
        &mut result
            .get_account(&s.creator.creator)
            .unwrap()
            .data
            .as_slice(),
    )
    .unwrap()
}

fn event(h: &Harness) -> Pledged {
    let mut emitted = events::<Pledged>(&h.logs());
    assert_eq!(emitted.len(), 1);
    emitted.pop().unwrap()
}

#[test]
fn a_first_contribution_creates_the_pledge_next_to_the_real_transfer() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);

    h.warp(498_418_933, NOW);
    let result = contribute(&mut h, &s, &state, 3, true);

    let account = result.get_account(&s.pledge).unwrap();
    assert_eq!(account.owner, ccsupport::ID);
    assert_eq!(account.data.len(), 8 + Pledge::INIT_SPACE);
    let p = pledge_of(&result, &s);
    assert_eq!(p.creator, s.creator.wallet);
    assert_eq!(p.supporter, s.supporter);
    assert_eq!(p.started_at, NOW);
    assert_eq!(p.expires_at, NOW + 3 * PERIOD_SECONDS);
    assert_eq!(p.periods_total, 3);
    assert_eq!(p.contributions, 1);
    assert!(p.show_publicly);
    assert_eq!(p.last_slot, 498_418_933);
    assert_eq!(p.bump, s.pledge_bump);
    assert_eq!(creator_of(&result, &s).pledges_total, 1);

    let e = event(&h);
    assert_eq!(e.creator, s.creator.wallet);
    assert_eq!(e.supporter, s.supporter);
    assert_eq!(e.periods, 3);
    assert_eq!(e.started_at, NOW);
    assert_eq!(e.expires_at, NOW + 3 * PERIOD_SECONDS);
    assert_eq!(e.periods_total, 3);
    assert_eq!(e.contributions, 1);
    assert!(e.show_publicly);
    assert_eq!(e.slot, 498_418_933);
}

#[test]
fn a_renewal_before_expiry_extends_from_the_old_date() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);
    h.warp(100, NOW);
    let first = contribute(&mut h, &s, &state, 1, false);
    let state = state.after(&first, &s);

    let later = NOW + PERIOD_SECONDS / 2;
    h.warp(200, later);
    let result = contribute(&mut h, &s, &state, 2, true);

    let p = pledge_of(&result, &s);
    assert_eq!(p.started_at, NOW);
    assert_eq!(p.expires_at, NOW + 3 * PERIOD_SECONDS);
    assert_eq!(p.periods_total, 3);
    assert_eq!(p.contributions, 2);
    assert!(p.show_publicly, "прапорець перезаписується аргументом");
    assert_eq!(p.last_slot, 200);
    assert_eq!(creator_of(&result, &s).pledges_total, 1);
    assert_eq!(
        result.get_account(&s.pledge).unwrap().lamports,
        state.pledge.lamports,
        "поновлення не тягне ренти вдруге"
    );

    let e = event(&h);
    assert_eq!(e.contributions, 2);
    assert_eq!(e.expires_at, NOW + 3 * PERIOD_SECONDS);
}

#[test]
fn a_renewal_after_expiry_restarts_from_now() {
    let s = pledge_setup();
    let mut h = Harness::new();
    let state = bootstrap(&mut h, &s);
    h.warp(100, NOW);
    let first = contribute(&mut h, &s, &state, 1, false);
    let state = state.after(&first, &s);

    let lapsed = NOW + PERIOD_SECONDS + GRACE_SECONDS + 1;
    h.warp(300, lapsed);
    let result = contribute(&mut h, &s, &state, 12, false);

    let p = pledge_of(&result, &s);
    assert_eq!(p.started_at, NOW, "дата початку — від першого внеску");
    assert_eq!(p.expires_at, lapsed + 12 * PERIOD_SECONDS);
    assert_eq!(p.periods_total, 13);
    assert_eq!(p.contributions, 2);
    assert!(!p.show_publicly);
    assert_eq!(creator_of(&result, &s).pledges_total, 1);
}
