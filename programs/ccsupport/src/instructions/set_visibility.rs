use anchor_lang::prelude::*;

use crate::events::VisibilityChanged;
use crate::state::Pledge;

#[derive(Accounts)]
pub struct SetVisibility<'info> {
    pub supporter: Signer<'info>,
    #[account(
        mut,
        seeds = [Pledge::SEED, pledge.creator.as_ref(), supporter.key().as_ref()],
        bump = pledge.bump,
    )]
    pub pledge: Account<'info, Pledge>,
}

pub fn set_visibility_handler(ctx: Context<SetVisibility>, show_publicly: bool) -> Result<()> {
    let pledge = &mut ctx.accounts.pledge;
    pledge.show_publicly = show_publicly;

    emit!(VisibilityChanged {
        creator: pledge.creator,
        supporter: pledge.supporter,
        show_publicly,
        slot: Clock::get()?.slot,
    });
    Ok(())
}
