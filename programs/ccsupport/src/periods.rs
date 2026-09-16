use anchor_lang::prelude::*;

use crate::errors::CcsError;

// The same numbers live in `packages/shared/periods.ts` and in the index SQL;
// `fixtures/periods.json` cross-checks all three.
pub const PERIOD_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const GRACE_SECONDS: i64 = 3 * 24 * 60 * 60;
pub const MAX_PERIODS: u8 = 12;

pub fn extend_expiry(now: i64, expires_at: i64, periods: u8) -> Result<i64> {
    require!(
        (1..=MAX_PERIODS).contains(&periods),
        CcsError::InvalidPeriods
    );
    Ok(now.max(expires_at) + i64::from(periods) * PERIOD_SECONDS)
}

#[cfg(test)]
mod tests {
    use super::{extend_expiry, GRACE_SECONDS, MAX_PERIODS, PERIOD_SECONDS};
    use crate::errors::CcsError;
    use anchor_lang::error::Error;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/periods.json");

    #[test]
    fn constants_match_the_shared_fixture() {
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap();
        assert_eq!(json["periodSeconds"].as_i64().unwrap(), PERIOD_SECONDS);
        assert_eq!(json["graceSeconds"].as_i64().unwrap(), GRACE_SECONDS);
        assert_eq!(json["maxPeriods"].as_u64().unwrap(), u64::from(MAX_PERIODS));
    }

    #[test]
    fn a_first_pledge_counts_from_now() {
        assert_eq!(extend_expiry(1_000, 0, 1).unwrap(), 1_000 + PERIOD_SECONDS);
        assert_eq!(
            extend_expiry(1_000, 0, 12).unwrap(),
            1_000 + 12 * PERIOD_SECONDS
        );
    }

    #[test]
    fn a_renewal_before_expiry_continues_from_the_old_date() {
        let expires_at = 1_000 + PERIOD_SECONDS;
        assert_eq!(
            extend_expiry(1_500, expires_at, 3).unwrap(),
            expires_at + 3 * PERIOD_SECONDS
        );
    }

    #[test]
    fn a_renewal_after_expiry_restarts_from_now() {
        let expires_at = 1_000 + PERIOD_SECONDS;
        let now = expires_at + GRACE_SECONDS + 1;
        assert_eq!(
            extend_expiry(now, expires_at, 2).unwrap(),
            now + 2 * PERIOD_SECONDS
        );
    }

    #[test]
    fn periods_outside_one_to_twelve_are_rejected() {
        for periods in [0, 13, u8::MAX] {
            match extend_expiry(1_000, 0, periods).unwrap_err() {
                Error::AnchorError(e) => {
                    assert_eq!(e.error_code_number, u32::from(CcsError::InvalidPeriods))
                }
                other => panic!("{other:?}"),
            }
        }
    }
}
