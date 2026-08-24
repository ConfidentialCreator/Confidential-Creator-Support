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
