use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use solana_instructions_sysvar::load_instruction_at_checked;

use crate::errors::CcsError;

// `TokenInstruction::ConfidentialTransferExtension` і `ConfidentialTransferInstruction::Transfer`
// (spl-token-2022-interface 2.1); розкладка акаунтів — source, mint, destination,
// далі акаунти доказів (їх число залежить від форми доказу), authority останній.
const CONFIDENTIAL_TRANSFER_EXTENSION: u8 = 27;
const TRANSFER: u8 = 7;
const SOURCE: usize = 0;
const MINT: usize = 1;
const DESTINATION: usize = 2;
const MIN_ACCOUNTS: usize = 4;

pub struct ExpectedTransfer {
    pub mint: Pubkey,
    pub source: Pubkey,
    pub destination: Pubkey,
    pub authority: Pubkey,
}

// Перший переказ, що збігається повністю, задовольняє; якщо такого немає, звіт —
// про перший знайдений CT-переказ, бо саме його клієнт і мав на увазі.
pub fn find_confidential_transfer(
    instructions: &AccountInfo,
    expected: &ExpectedTransfer,
) -> Result<()> {
    let mut first_mismatch: Option<Error> = None;
    for index in 0.. {
        let ix = match load_instruction_at_checked(index, instructions) {
            Ok(ix) => ix,
            Err(ProgramError::InvalidArgument) => break,
            Err(e) => return Err(e.into()),
        };
        let is_confidential_transfer = ix.program_id == token_2022::ID
            && ix.data.len() >= 2
            && ix.data[0] == CONFIDENTIAL_TRANSFER_EXTENSION
            && ix.data[1] == TRANSFER
            && ix.accounts.len() >= MIN_ACCOUNTS;
        if !is_confidential_transfer {
            continue;
        }
        match matches_expected(&ix.accounts, expected) {
            Ok(()) => return Ok(()),
            Err(e) => {
                first_mismatch.get_or_insert(e);
            }
        }
    }
    Err(first_mismatch.unwrap_or_else(|| error!(CcsError::TransferNotFound)))
}

fn matches_expected(accounts: &[AccountMeta], expected: &ExpectedTransfer) -> Result<()> {
    require_keys_eq!(accounts[MINT].pubkey, expected.mint, CcsError::WrongMint);
    require_keys_eq!(
        accounts[DESTINATION].pubkey,
        expected.destination,
        CcsError::WrongDestination
    );
    require_keys_eq!(
        accounts[SOURCE].pubkey,
        expected.source,
        CcsError::WrongSource
    );
    let authority = &accounts[accounts.len() - 1];
    require!(
        authority.is_signer && authority.pubkey == expected.authority,
        CcsError::WrongAuthority
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_confidential_transfer, ExpectedTransfer};
    use crate::errors::CcsError;
    use anchor_lang::error::Error;
    use anchor_lang::prelude::*;
    use anchor_spl::token_2022;
    use solana_instruction::{AccountMeta, Instruction};

    const TOKEN_LEGACY: Pubkey =
        Pubkey::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

    fn expected() -> ExpectedTransfer {
        ExpectedTransfer {
            mint: Pubkey::new_unique(),
            source: Pubkey::new_unique(),
            destination: Pubkey::new_unique(),
            authority: Pubkey::new_unique(),
        }
    }

    // Розкладка з фікстури T006: source, mint, destination, три context-state
    // акаунти доказів, authority останній.
    fn ct_transfer(e: &ExpectedTransfer) -> Instruction {
        Instruction {
            program_id: token_2022::ID,
            accounts: vec![
                AccountMeta::new(e.source, false),
                AccountMeta::new_readonly(e.mint, false),
                AccountMeta::new(e.destination, false),
                AccountMeta::new_readonly(Pubkey::new_unique(), false),
                AccountMeta::new_readonly(Pubkey::new_unique(), false),
                AccountMeta::new_readonly(Pubkey::new_unique(), false),
                AccountMeta::new(e.authority, true),
            ],
            data: vec![27, 7, 0, 0, 0, 0, 0, 0, 0, 0],
        }
    }

    fn own_instruction() -> Instruction {
        Instruction {
            program_id: crate::ID,
            accounts: vec![AccountMeta::new(Pubkey::new_unique(), true)],
            data: vec![1, 2, 3],
        }
    }

    fn with_sysvar<R>(
        instructions: &[Instruction],
        key: Option<Pubkey>,
        f: impl FnOnce(&AccountInfo) -> R,
    ) -> R {
        let (sysvar_key, mut account) =
            mollusk_svm::instructions_sysvar::keyed_account(instructions.iter());
        let key = key.unwrap_or(sysvar_key);
        let mut lamports = account.lamports;
        let info = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut account.data,
            &account.owner,
            false,
        );
        f(&info)
    }

    fn run(instructions: &[Instruction], e: &ExpectedTransfer) -> Result<()> {
        with_sysvar(instructions, None, |info| {
            find_confidential_transfer(info, e)
        })
    }

    fn code(result: Result<()>) -> u32 {
        match result.unwrap_err() {
            Error::AnchorError(e) => e.error_code_number,
            other => panic!("очікувалась AnchorError, отримано {other:?}"),
        }
    }

    #[test]
    fn finds_the_transfer_regardless_of_its_position() {
        let e = expected();
        assert!(run(&[ct_transfer(&e), own_instruction()], &e).is_ok());
        assert!(run(&[own_instruction(), ct_transfer(&e)], &e).is_ok());
        assert!(run(&[own_instruction(), ct_transfer(&e), own_instruction()], &e).is_ok());
    }

    #[test]
    fn reports_not_found_without_a_confidential_transfer() {
        let e = expected();
        let mut apply_pending_balance = ct_transfer(&e);
        apply_pending_balance.data = vec![27, 8];
        let mut legacy_transfer = ct_transfer(&e);
        legacy_transfer.program_id = TOKEN_LEGACY;
        let mut plain_transfer = ct_transfer(&e);
        plain_transfer.data = vec![3, 0, 0, 0, 0, 0, 0, 0, 0];
        let mut too_short = ct_transfer(&e);
        too_short.data = vec![27];
        let mut too_few_accounts = ct_transfer(&e);
        too_few_accounts.accounts.truncate(3);

        let ixs = [
            own_instruction(),
            apply_pending_balance,
            legacy_transfer,
            plain_transfer,
            too_short,
            too_few_accounts,
        ];
        assert_eq!(code(run(&ixs, &e)), u32::from(CcsError::TransferNotFound));
        assert_eq!(
            code(run(&[own_instruction()], &e)),
            u32::from(CcsError::TransferNotFound)
        );
    }

    #[test]
    fn each_mismatch_has_its_own_code() {
        let e = expected();

        let mut wrong_mint = ct_transfer(&e);
        wrong_mint.accounts[1].pubkey = Pubkey::new_unique();
        assert_eq!(code(run(&[wrong_mint], &e)), u32::from(CcsError::WrongMint));

        let mut wrong_destination = ct_transfer(&e);
        wrong_destination.accounts[2].pubkey = Pubkey::new_unique();
        assert_eq!(
            code(run(&[wrong_destination], &e)),
            u32::from(CcsError::WrongDestination)
        );

        let mut wrong_source = ct_transfer(&e);
        wrong_source.accounts[0].pubkey = Pubkey::new_unique();
        assert_eq!(
            code(run(&[wrong_source], &e)),
            u32::from(CcsError::WrongSource)
        );

        let mut wrong_authority = ct_transfer(&e);
        wrong_authority.accounts[6].pubkey = Pubkey::new_unique();
        assert_eq!(
            code(run(&[wrong_authority], &e)),
            u32::from(CcsError::WrongAuthority)
        );

        let mut unsigned_authority = ct_transfer(&e);
        unsigned_authority.accounts[6].is_signer = false;
        assert_eq!(
            code(run(&[unsigned_authority], &e)),
            u32::from(CcsError::WrongAuthority)
        );
    }

    #[test]
    fn authority_is_the_last_account_even_with_inline_proofs() {
        let e = expected();
        let mut inline = ct_transfer(&e);
        inline.accounts.drain(3..6);
        assert_eq!(inline.accounts.len(), 4);
        assert!(run(&[inline], &e).is_ok());
    }

    #[test]
    fn any_fully_matching_transfer_satisfies_and_the_first_mismatch_is_reported() {
        let e = expected();
        let mut to_someone_else = ct_transfer(&e);
        to_someone_else.accounts[2].pubkey = Pubkey::new_unique();
        assert!(run(&[to_someone_else.clone(), ct_transfer(&e)], &e).is_ok());

        let mut wrong_mint = ct_transfer(&e);
        wrong_mint.accounts[1].pubkey = Pubkey::new_unique();
        assert_eq!(
            code(run(&[to_someone_else, wrong_mint], &e)),
            u32::from(CcsError::WrongDestination)
        );
    }

    #[test]
    fn a_foreign_sysvar_account_is_an_error_not_a_miss() {
        let e = expected();
        let result = with_sysvar(&[ct_transfer(&e)], Some(Pubkey::new_unique()), |info| {
            find_confidential_transfer(info, &e)
        });
        assert!(matches!(result, Err(Error::ProgramError(_))));
    }
}
