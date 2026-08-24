use anchor_lang::prelude::*;

#[error_code]
pub enum CcsError {
    #[msg("handle is already taken")]
    HandleTaken,
    #[msg("handle must be 3..32 chars of [a-z0-9-]")]
    InvalidHandle,
    #[msg("name is longer than 64 bytes")]
    NameTooLong,
    #[msg("description is longer than 256 bytes")]
    DescriptionTooLong,
    #[msg("no confidential transfer to the creator in this transaction")]
    TransferNotFound,
    #[msg("transfer uses a mint other than the platform mint")]
    WrongMint,
    #[msg("transfer destination is not the creator's token account")]
    WrongDestination,
    #[msg("transfer authority is not the supporter")]
    WrongAuthority,
    #[msg("periods must be within 1..=12")]
    InvalidPeriods,
}
