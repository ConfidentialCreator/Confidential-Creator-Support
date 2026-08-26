use anchor_lang::prelude::*;

// Повний профіль у кожній події: worker заповнює `creators` з логів, без
// дочитування акаунта і гонки «акаунт уже змінено».
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

// Знімок `Pledge` після внеску: worker робить upsert у `pledges` і додає рядок у
// `contributions` (перший внесок — `contributions == 1`) без дочитування акаунта.
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
