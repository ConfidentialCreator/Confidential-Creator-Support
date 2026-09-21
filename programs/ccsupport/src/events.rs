use anchor_lang::prelude::*;

// The full profile in every event: the worker fills `creators` from the logs, with no
// account re-read and no "account already changed" race.
#[event]
pub struct CreatorRegistered {
    pub wallet: Pubkey,
    pub handle: String,
    pub name: String,
    pub description: String,
    pub suggested_amount: u64,
    pub slot: u64,
}

#[event]
pub struct CreatorUpdated {
    pub wallet: Pubkey,
    pub handle: String,
    pub name: String,
    pub description: String,
    pub suggested_amount: u64,
    pub slot: u64,
}

// The `Pledge` snapshot after a contribution: the worker upserts `pledges` and adds a row to
// `contributions` (first contribution — `contributions == 1`) without re-reading the account.
#[event]
pub struct Pledged {
    pub creator: Pubkey,
    pub supporter: Pubkey,
    pub periods: u8,
    pub started_at: i64,
    pub expires_at: i64,
    pub periods_total: u32,
    pub contributions: u32,
    pub show_publicly: bool,
    pub slot: u64,
}

#[event]
pub struct VisibilityChanged {
    pub creator: Pubkey,
    pub supporter: Pubkey,
    pub show_publicly: bool,
    pub slot: u64,
}
