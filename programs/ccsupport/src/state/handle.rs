use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Handle {
    pub creator: Pubkey,
    pub bump: u8,
}

impl Handle {
    pub const SEED: &'static [u8] = b"handle";
}
