use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use mollusk_svm::program::loader_keys::LOADER_V3;
use mollusk_svm::result::{Check, InstructionResult};
use mollusk_svm::Mollusk;
use solana_account::Account;
use solana_instruction::{AccountMeta, Instruction};
use solana_instructions_sysvar::store_current_index_checked;
use solana_pubkey::Pubkey;
use solana_svm_log_collector::LogCollector;

pub const TOKEN_2022: Pubkey =
    Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const ELF: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/ccsupport.so"
);
const TRANSFER_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/tx/transfer.json"
);

pub struct Harness {
    pub mollusk: Mollusk,
}

impl Default for Harness {
    fn default() -> Self {
        Self::new()
    }
}

impl Harness {
    // ELF береться явно з `target/deploy`, а не через пошук mollusk по cwd:
    // `cargo test` запускається з теки пакета, де `target/` немає.
    pub fn new() -> Self {
        let elf = std::fs::read(ELF).unwrap_or_else(|e| panic!("{ELF}: {e} — спершу build-sbf"));
        let mut mollusk = Mollusk::default();
        mollusk.add_program_with_loader_and_elf(&ccsupport::ID, &LOADER_V3, &elf);
        Self { mollusk }
    }

    // `warp_to_slot` перебудовує Clock з нуля і обнуляє unix_timestamp —
    // вестинг-тести з таким годинником зеленіють на «зараз = 0».
    pub fn warp(&mut self, slot: u64, unix_timestamp: i64) {
        self.mollusk.warp_to_slot(slot);
        self.mollusk.sysvars.clock.unix_timestamp = unix_timestamp;
    }

    // Ліміт LogCollector (10 КБ) рахується за все життя збирача, а не за прогін:
    // зі спільним збирачем події зникають десь із 15-го виклику.
    pub fn process(
        &mut self,
        instruction: &Instruction,
        accounts: &[(Pubkey, Account)],
        checks: &[Check],
    ) -> InstructionResult {
        self.mollusk.logger = Some(LogCollector::new_ref());
        self.mollusk
            .process_and_validate_instruction(instruction, accounts, checks)
    }

    pub fn logs(&self) -> Vec<String> {
        self.mollusk
            .logger
            .as_ref()
            .map(|l| l.borrow().get_recorded_content().to_vec())
            .unwrap_or_default()
    }
}

// mollusk підкладає sysvar `Instructions` лише з тієї інструкції, яку виконує, і
// поточний індекс не записує (це робить solana-svm, якого тут немає). Акаунт,
// переданий явно, має пріоритет над підкладеним.
pub fn instructions_sysvar(instructions: &[Instruction], current: usize) -> (Pubkey, Account) {
    let (key, mut account) = mollusk_svm::instructions_sysvar::keyed_account(instructions.iter());
    store_current_index_checked(&mut account.data, current as u16).unwrap();
    (key, account)
}

pub fn fixture_transfer() -> Instruction {
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(TRANSFER_FIXTURE).unwrap()).unwrap();
    let wire = STANDARD.decode(json["wire"].as_str().unwrap()).unwrap();
    let mut instructions = decode_message_instructions(&wire);
    assert_eq!(instructions.len(), 1, "фікстура має рівно одну інструкцію");
    instructions.pop().unwrap()
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn u8(&mut self) -> u8 {
        let v = self.bytes[self.pos];
        self.pos += 1;
        v
    }

    fn compact_u16(&mut self) -> usize {
        let mut value = 0usize;
        let mut shift = 0;
        loop {
            let byte = self.u8();
            value |= usize::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return value;
            }
            shift += 7;
        }
    }

    fn take(&mut self, len: usize) -> &'a [u8] {
        let slice = &self.bytes[self.pos..self.pos + len];
        self.pos += len;
        slice
    }
}

// Wire-формат транзакції з kit: підписи, далі повідомлення legacy або v0 (старший
// біт першого байта). Таблиць адрес у фікстурах немає — всі ключі статичні.
fn decode_message_instructions(wire: &[u8]) -> Vec<Instruction> {
    let mut c = Cursor {
        bytes: wire,
        pos: 0,
    };
    let signatures = c.compact_u16();
    c.take(64 * signatures);

    if c.bytes[c.pos] & 0x80 != 0 {
        c.u8();
    }
    let required_signatures = usize::from(c.u8());
    let readonly_signed = usize::from(c.u8());
    let readonly_unsigned = usize::from(c.u8());

    let keys_len = c.compact_u16();
    let keys: Vec<Pubkey> = (0..keys_len)
        .map(|_| Pubkey::try_from(c.take(32)).unwrap())
        .collect();
    c.take(32);

    let is_signer = |i: usize| i < required_signatures;
    let is_writable = |i: usize| {
        if i < required_signatures {
            i < required_signatures - readonly_signed
        } else {
            i < keys_len - readonly_unsigned
        }
    };

    let instructions_len = c.compact_u16();
    let instructions = (0..instructions_len)
        .map(|_| {
            let program_id = keys[usize::from(c.u8())];
            let accounts_len = c.compact_u16();
            let accounts = c
                .take(accounts_len)
                .iter()
                .map(|&i| {
                    let i = usize::from(i);
                    AccountMeta {
                        pubkey: keys[i],
                        is_signer: is_signer(i),
                        is_writable: is_writable(i),
                    }
                })
                .collect();
            let data_len = c.compact_u16();
            Instruction {
                program_id,
                accounts,
                data: c.take(data_len).to_vec(),
            }
        })
        .collect();

    let lookups = if c.pos < c.bytes.len() {
        c.compact_u16()
    } else {
        0
    };
    assert_eq!(lookups, 0, "таблиці адрес у фікстурі не підтримуються");
    instructions
}
