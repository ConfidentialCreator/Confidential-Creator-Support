use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z");

#[program]
pub mod ccsupport {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        instructions::init_config_handler(ctx)
    }
}
