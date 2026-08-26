use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_2022;

use crate::errors::CcsError;
use crate::events::Pledged;
use crate::introspect::{find_confidential_transfer, ExpectedTransfer};
use crate::periods::{extend_expiry, MAX_PERIODS};
use crate::state::{Config, Creator, Pledge};

#[derive(Accounts)]
pub struct MakePledge<'info> {
    #[account(mut)]
    pub supporter: Signer<'info>,
    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [Creator::SEED, creator.wallet.as_ref()],
        bump = creator.bump,
    )]
    pub creator: Account<'info, Creator>,
    #[account(
        init_if_needed,
        payer = supporter,
        space = 8 + Pledge::INIT_SPACE,
        seeds = [Pledge::SEED, creator.wallet.as_ref(), supporter.key().as_ref()],
        bump,
    )]
    pub pledge: Account<'info, Pledge>,
    /// CHECK: Instructions sysvar; the confidential transfer next to this instruction is read from it.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn pledge_handler(ctx: Context<MakePledge>, periods: u8, show_publicly: bool) -> Result<()> {
    require!(
        (1..=MAX_PERIODS).contains(&periods),
        CcsError::InvalidPeriods
    );

    let mint = ctx.accounts.config.mint;
    let supporter = ctx.accounts.supporter.key();
    let creator_wallet = ctx.accounts.creator.wallet;
    find_confidential_transfer(
        &ctx.accounts.instructions,
        &ExpectedTransfer {
            mint,
            source: get_associated_token_address_with_program_id(
                &supporter,
                &mint,
                &token_2022::ID,
            ),
            destination: get_associated_token_address_with_program_id(
                &creator_wallet,
                &mint,
                &token_2022::ID,
            ),
            authority: supporter,
        },
    )?;

    let clock = Clock::get()?;
    let pledge = &mut ctx.accounts.pledge;
    if pledge.contributions == 0 {
        pledge.creator = creator_wallet;
        pledge.supporter = supporter;
        pledge.started_at = clock.unix_timestamp;
        pledge.bump = ctx.bumps.pledge;
        ctx.accounts.creator.pledges_total += 1;
    }
    pledge.expires_at = extend_expiry(clock.unix_timestamp, pledge.expires_at, periods)?;
    pledge.periods_total += u32::from(periods);
    pledge.contributions += 1;
    pledge.show_publicly = show_publicly;
    pledge.last_slot = clock.slot;

    emit!(Pledged {
        creator: creator_wallet,
        supporter,
        periods,
        started_at: pledge.started_at,
        expires_at: pledge.expires_at,
        periods_total: pledge.periods_total,
        contributions: pledge.contributions,
        show_publicly,
        slot: clock.slot,
    });
    Ok(())
}
