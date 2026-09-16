use anchor_lang::prelude::*;

pub const HANDLE_LEN: usize = 32;
pub const NAME_MAX_LEN: usize = 64;
pub const DESCRIPTION_MAX_LEN: usize = 256;

// No contribution amount here, ever: the only number is the creator's public suggestion.
#[account]
#[derive(InitSpace)]
pub struct Creator {
    pub wallet: Pubkey,
    pub handle: [u8; HANDLE_LEN],
    #[max_len(NAME_MAX_LEN)]
    pub name: String,
    #[max_len(DESCRIPTION_MAX_LEN)]
    pub description: String,
    pub suggested_amount: u64,
    pub pledges_total: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl Creator {
    pub const SEED: &'static [u8] = b"creator";
}
