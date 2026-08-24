use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Pledge {
    pub creator: Pubkey,
    pub supporter: Pubkey,
    pub started_at: i64,
    pub expires_at: i64,
    pub periods_total: u32,
    pub contributions: u32,
    pub show_publicly: bool,
    pub last_slot: u64,
    pub bump: u8,
}

impl Pledge {
    pub const SEED: &'static [u8] = b"pledge";
}
