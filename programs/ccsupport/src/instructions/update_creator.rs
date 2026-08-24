use anchor_lang::prelude::*;

use crate::errors::CcsError;
use crate::events::CreatorUpdated;
use crate::state::{Creator, DESCRIPTION_MAX_LEN, NAME_MAX_LEN};

#[derive(Accounts)]
pub struct UpdateCreator<'info> {
    pub wallet: Signer<'info>,
    #[account(
        mut,
        seeds = [Creator::SEED, wallet.key().as_ref()],
        bump = creator.bump,
    )]
    pub creator: Account<'info, Creator>,
}

pub fn update_creator_handler(
    ctx: Context<UpdateCreator>,
    name: String,
    description: String,
    suggested_amount: u64,
) -> Result<()> {
    require!(name.len() <= NAME_MAX_LEN, CcsError::NameTooLong);
    require!(
        description.len() <= DESCRIPTION_MAX_LEN,
        CcsError::DescriptionTooLong
    );

    let creator = &mut ctx.accounts.creator;
    creator.name = name.clone();
    creator.description = description.clone();
    creator.suggested_amount = suggested_amount;

    let handle_len = creator
        .handle
        .iter()
        .position(|&b| b == 0)
        .unwrap_or(creator.handle.len());
    emit!(CreatorUpdated {
        wallet: creator.wallet,
        handle: String::from_utf8_lossy(&creator.handle[..handle_len]).into_owned(),
        name,
        description,
        suggested_amount,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
