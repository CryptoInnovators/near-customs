//! Wire format shared by the token contract, the verdict signer and the walker.
//! One definition of the signed message means a signer and a verifier cannot drift apart.

pub const MESSAGE_DOMAIN: &str = "customs/v1";
pub const VERDICT_UPHELD: &str = "upheld";
pub const VERDICT_REJECTED: &str = "rejected";

/// Bytes hashed (sha256, lowercase hex) to bind a verdict to the exact receipts a challenger named.
pub fn path_hash_input(path: &[String]) -> Vec<u8> {
    path.join("\n").into_bytes()
}

/// The exact bytes an enclave signs and the token verifies with `ed25519_verify`.
pub fn verdict_message(
    token: &str,
    wallet: &str,
    challenge_id: u64,
    path_hash_hex: &str,
    verdict: &str,
    block: u64,
) -> Vec<u8> {
    format!("{MESSAGE_DOMAIN}\n{token}\n{wallet}\n{challenge_id}\n{path_hash_hex}\n{verdict}\n{block}")
        .into_bytes()
}

/// The exact bytes the module signs to prove it controls the key it reports, and the token checks once
/// when it pins that key. Binds the key to one token account.
pub fn pin_message(token: &str, public_key: &str) -> Vec<u8> {
    format!("{MESSAGE_DOMAIN}/pin\n{token}\n{public_key}").into_bytes()
}

pub fn hex_lower(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 15) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_is_stable() {
        let m = verdict_message("t.near", "w.near", 7, "ab", VERDICT_UPHELD, 99);
        assert_eq!(m, b"customs/v1\nt.near\nw.near\n7\nab\nupheld\n99".to_vec());
    }

    #[test]
    fn every_field_changes_the_message() {
        let base = verdict_message("t.near", "w.near", 7, "ab", VERDICT_UPHELD, 99);
        assert_ne!(base, verdict_message("u.near", "w.near", 7, "ab", VERDICT_UPHELD, 99));
        assert_ne!(base, verdict_message("t.near", "x.near", 7, "ab", VERDICT_UPHELD, 99));
        assert_ne!(base, verdict_message("t.near", "w.near", 8, "ab", VERDICT_UPHELD, 99));
        assert_ne!(base, verdict_message("t.near", "w.near", 7, "ac", VERDICT_UPHELD, 99));
        assert_ne!(base, verdict_message("t.near", "w.near", 7, "ab", VERDICT_REJECTED, 99));
        assert_ne!(base, verdict_message("t.near", "w.near", 7, "ab", VERDICT_UPHELD, 100));
    }

    #[test]
    fn pin_message_binds_token_and_key() {
        let m = pin_message("t.near", "ed25519:K");
        assert_eq!(m, b"customs/v1/pin\nt.near\ned25519:K".to_vec());
        assert_ne!(m, pin_message("u.near", "ed25519:K"));
        assert_ne!(m, pin_message("t.near", "ed25519:L"));
    }

    #[test]
    fn hex_roundtrip_shape() {
        assert_eq!(hex_lower(&[0, 15, 255]), "000fff");
    }
}
