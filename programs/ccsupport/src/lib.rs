use anchor_lang::prelude::*;

declare_id!("8tX3MJt6vzw9fw7gAeBdEtom5cfXR8BMZn9UCPQJrj6z");

#[program]
pub mod ccsupport {
    use super::*;

    pub fn init_config(_ctx: Context<InitConfig>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitConfig {}
