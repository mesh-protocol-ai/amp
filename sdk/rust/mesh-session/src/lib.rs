use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

#[cfg(feature = "enterprise")]
pub mod enterprise;

// Note: enterprise placeholder does not pull extra crates by default.

type HmacSha256 = Hmac<Sha256>;

pub fn issue_simple_token(secret: &[u8], session_id: &str, consumer_did: &str, provider_did: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    let msg = format!("{}|{}|{}", session_id, consumer_did, provider_did);
    mac.update(msg.as_bytes());
    let result = mac.finalize().into_bytes();
    general_purpose::URL_SAFE_NO_PAD.encode(result)
}

pub fn validate_simple_token(token: &str, secret: &[u8], session_id: &str, consumer_did: &str, provider_did: &str) -> bool {
    let expected = issue_simple_token(secret, session_id, consumer_did, provider_did);
    // constant time compare
    expected.as_bytes().ct_eq(token.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_token() {
        let secret = b"supersecret";
        let token = issue_simple_token(secret, "sess-1", "did:mesh:agent:consumer", "did:mesh:agent:provider");
        assert!(validate_simple_token(&token, secret, "sess-1", "did:mesh:agent:consumer", "did:mesh:agent:provider"));
    }
}
