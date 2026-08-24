use anchor_lang::prelude::*;

use super::HANDLE_LEN;

#[account]
#[derive(InitSpace)]
pub struct Handle {
    pub creator: Pubkey,
    pub bump: u8,
}

impl Handle {
    pub const SEED: &'static [u8] = b"handle";
}

// Те саме, що `^[a-z0-9-]{3,32}$` у `fixtures/handle.json`; довжина в байтах, бо
// handle іде seed-ом PDA, а seed обмежений 32 байтами.
pub fn is_valid_handle(handle: &str) -> bool {
    (3..=HANDLE_LEN).contains(&handle.len())
        && handle
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::is_valid_handle;

    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/handle.json");

    fn fixture() -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).unwrap()).unwrap()
    }

    fn strings(value: &serde_json::Value) -> Vec<&str> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect()
    }

    #[test]
    fn accepts_every_valid_handle_from_the_shared_fixture() {
        let json = fixture();
        for handle in strings(&json["valid"]) {
            assert!(is_valid_handle(handle), "{handle:?} має бути валідним");
        }
    }

    #[test]
    fn rejects_every_invalid_handle_from_the_shared_fixture() {
        let json = fixture();
        for handle in strings(&json["invalid"]) {
            assert!(!is_valid_handle(handle), "{handle:?} має бути невалідним");
        }
    }

    #[test]
    fn length_is_counted_in_bytes_not_chars() {
        // «а» — 2 байти в UTF-8: 16 таких символів дають 32 байти, але це не [a-z0-9-]
        assert!(!is_valid_handle(&"а".repeat(16)));
        assert!(is_valid_handle(&"a".repeat(32)));
        assert!(!is_valid_handle(&"a".repeat(33)));
        assert!(is_valid_handle("---"));
    }
}
