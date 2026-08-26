use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod introspect;
pub mod periods;
pub mod state;

use instructions::*;

declare_id!("8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z");

#[program]
pub mod ccsupport {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        instructions::init_config_handler(ctx)
    }

    pub fn register_creator(
        ctx: Context<RegisterCreator>,
        handle: String,
        name: String,
        description: String,
    ) -> Result<()> {
        instructions::register_creator_handler(ctx, handle, name, description)
    }

    pub fn update_creator(
        ctx: Context<UpdateCreator>,
        name: String,
        description: String,
        suggested_amount: u64,
    ) -> Result<()> {
        instructions::update_creator_handler(ctx, name, description, suggested_amount)
    }

    pub fn pledge(ctx: Context<MakePledge>, periods: u8, show_publicly: bool) -> Result<()> {
        instructions::pledge_handler(ctx, periods, show_publicly)
    }
}
