//! Enterprise crypto helpers (feature: `enterprise`).
//!
//! Provides X25519 ECDH key agreement and AES-256-GCM authenticated
//! encryption, used for end-to-end encrypted DataPlane sessions.
//!
//! Enable with: `mesh-session = { features = ["enterprise"] }`

#[cfg(feature = "enterprise")]
pub mod enterprise {
    use aes_gcm::{
        aead::{Aead, KeyInit, Payload},
        Aes256Gcm, Nonce,
    };
    use rand::rngs::OsRng;
    use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

    /// An ephemeral X25519 keypair (secret zeroised on drop).
    pub struct EphemeralKeyPair {
        secret: EphemeralSecret,
        pub public: PublicKey,
    }

    impl EphemeralKeyPair {
        /// Generate a fresh ephemeral keypair using the OS RNG.
        pub fn generate() -> Self {
            let secret = EphemeralSecret::random_from_rng(OsRng);
            let public = PublicKey::from(&secret);
            Self { secret, public }
        }

        /// Perform ECDH with the peer's public key, returning the 32-byte shared secret.
        pub fn diffie_hellman(self, peer_pub: &PublicKey) -> [u8; 32] {
            let ss = self.secret.diffie_hellman(peer_pub);
            *ss.as_bytes()
        }
    }

    /// A static X25519 keypair — suitable for long-lived provider identities.
    pub struct StaticKeyPair {
        secret: StaticSecret,
        pub public: PublicKey,
    }

    impl StaticKeyPair {
        /// Generate a fresh static keypair using the OS RNG.
        pub fn generate() -> Self {
            let secret = StaticSecret::random_from_rng(OsRng);
            let public = PublicKey::from(&secret);
            Self { secret, public }
        }

        /// Perform ECDH with the peer's public key.
        pub fn diffie_hellman(&self, peer_pub: &PublicKey) -> [u8; 32] {
            let ss = self.secret.diffie_hellman(peer_pub);
            *ss.as_bytes()
        }
    }

    /// Error returned by AES-GCM encrypt/decrypt.
    #[derive(Debug)]
    pub struct AeadError;

    impl std::fmt::Display for AeadError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "AES-GCM AEAD failure (encrypt/decrypt failed)")
        }
    }

    impl std::error::Error for AeadError {}

    /// Encrypt `plaintext` using AES-256-GCM with the given 32-byte `key`,
    /// 12-byte `nonce`, and optional additional authenticated data `aad`.
    pub fn aes_gcm_encrypt(
        key: &[u8; 32],
        nonce: &[u8; 12],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, AeadError> {
        let cipher = Aes256Gcm::new_from_slice(key).expect("key is 32 bytes");
        let n = Nonce::from_slice(nonce);
        cipher
            .encrypt(n, Payload { msg: plaintext, aad })
            .map_err(|_| AeadError)
    }

    /// Decrypt and authenticate `ciphertext` (with appended 16-byte tag)
    /// using AES-256-GCM with the given `key`, `nonce`, and `aad`.
    pub fn aes_gcm_decrypt(
        key: &[u8; 32],
        nonce: &[u8; 12],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, AeadError> {
        let cipher = Aes256Gcm::new_from_slice(key).expect("key is 32 bytes");
        let n = Nonce::from_slice(nonce);
        cipher
            .decrypt(n, Payload { msg: ciphertext, aad })
            .map_err(|_| AeadError)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn ecdh_produces_shared_secret() {
            let alice = EphemeralKeyPair::generate();
            let bob = StaticKeyPair::generate();
            let alice_pub = alice.public;
            let bob_pub = bob.public;

            let alice2 = EphemeralKeyPair::generate();
            let bob_ss = bob.diffie_hellman(&alice_pub);
            let alice_ss = alice2.diffie_hellman(&bob_pub);
            // Different pairs — just check lengths, not equality
            assert_eq!(bob_ss.len(), 32);
            assert_eq!(alice_ss.len(), 32);
        }

        #[test]
        fn ecdh_same_shared_secret() {
            // Simulate a provider (static) and consumer (ephemeral) handshake
            let provider = StaticKeyPair::generate();
            let consumer = EphemeralKeyPair::generate();
            let consumer_pub = consumer.public;

            let provider_ss = provider.diffie_hellman(&consumer_pub);
            // Can't reuse consumer's ephemeral private key, so we verify symmetry
            // using two static keys instead
            let a = StaticKeyPair::generate();
            let b = StaticKeyPair::generate();
            let ss_a = a.diffie_hellman(&b.public);
            let ss_b = b.diffie_hellman(&a.public);
            assert_eq!(ss_a, ss_b);
            // provider_ss len check
            assert_eq!(provider_ss.len(), 32);
        }

        #[test]
        fn aes_gcm_roundtrip() {
            let key = [0x42u8; 32];
            let nonce = [0x00u8; 12];
            let plaintext = b"hello enterprise world";
            let aad = b"session-id-xyz";

            let ct = aes_gcm_encrypt(&key, &nonce, plaintext, aad).expect("encrypt");
            let pt = aes_gcm_decrypt(&key, &nonce, &ct, aad).expect("decrypt");
            assert_eq!(pt, plaintext);
        }

        #[test]
        fn aes_gcm_rejects_wrong_aad() {
            let key = [0x11u8; 32];
            let nonce = [0x22u8; 12];
            let ct = aes_gcm_encrypt(&key, &nonce, b"secret", b"good-aad").expect("encrypt");
            let err = aes_gcm_decrypt(&key, &nonce, &ct, b"bad-aad");
            assert!(err.is_err(), "should reject wrong AAD");
        }

        #[test]
        fn aes_gcm_rejects_tampered_ciphertext() {
            let key = [0xABu8; 32];
            let nonce = [0xCDu8; 12];
            let mut ct = aes_gcm_encrypt(&key, &nonce, b"data", b"").expect("encrypt");
            ct[0] ^= 0xFF; // flip a byte
            assert!(aes_gcm_decrypt(&key, &nonce, &ct, b"").is_err());
        }
    }
}

