use anchor_lang::prelude::*;

use crate::errors::CcsError;
use crate::events::CreatorRegistered;
use crate::state::{
    is_valid_handle, Creator, Handle, DESCRIPTION_MAX_LEN, HANDLE_LEN, NAME_MAX_LEN,
};

#[derive(Accounts)]
#[instruction(handle: String)]
pub struct RegisterCreator<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(
        init,
        payer = wallet,
        space = 8 + Creator::INIT_SPACE,
        seeds = [Creator::SEED, wallet.key().as_ref()],
        bump,
    )]
    pub creator: Account<'info, Creator>,
    #[account(
        init,
        payer = wallet,
        space = 8 + Handle::INIT_SPACE,
        // Anchor runs every `init` before any constraint and before the handler, and a seed
        // over 32 bytes makes the PDA derivation panic — truncating lets a long handle
        // reach `InvalidHandle` instead of an abort.
        seeds = [Handle::SEED, &handle.as_bytes()[..handle.len().min(HANDLE_LEN)]],
        bump,
    )]
    pub handle_account: Account<'info, Handle>,
    pub system_program: Program<'info, System>,
}

pub fn register_creator_handler(
    ctx: Context<RegisterCreator>,
    handle: String,
    name: String,
    description: String,
) -> Result<()> {
    require!(is_valid_handle(&handle), CcsError::InvalidHandle);
    require!(name.len() <= NAME_MAX_LEN, CcsError::NameTooLong);
    require!(
        description.len() <= DESCRIPTION_MAX_LEN,
        CcsError::DescriptionTooLong
    );
    let clock = Clock::get()?;

    let creator = &mut ctx.accounts.creator;
    creator.wallet = ctx.accounts.wallet.key();
    creator.handle[..handle.len()].copy_from_slice(handle.as_bytes());
    creator.name = name.clone();
    creator.description = description.clone();
    creator.suggested_amount = 0;
    creator.pledges_total = 0;
    creator.created_at = clock.unix_timestamp;
    creator.bump = ctx.bumps.creator;

    let handle_account = &mut ctx.accounts.handle_account;
    handle_account.creator = creator.key();
    handle_account.bump = ctx.bumps.handle_account;

    emit!(CreatorRegistered {
        wallet: creator.wallet,
        handle,
        name,
        description,
        suggested_amount: 0,
        slot: clock.slot,
    });
    Ok(())
}
