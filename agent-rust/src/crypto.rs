//! Cryptographic primitives for the BPAS agent.
//!
//! - `HmacKey` holds the symmetric key derived either from the TPM or, in
//!   development, from a software key file. It zeroes itself on drop.
//! - `sign_event` computes HMAC-SHA256 over the canonical serialization of an
//!   event (nonce || ts || kind || payload).
//! - A monotonic nonce generator enforces strict ordering per session and
//!   rejects reuse.

use crate::config::TpmConfig;
use anyhow::{anyhow, Context, Result};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use std::sync::atomic::{AtomicU64, Ordering};
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, ZeroizeOnDrop};

type HmacSha256 = Hmac<Sha256>;

/// 32-byte HMAC key that is zeroed when dropped.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct HmacKey {
    key: [u8; 32],
}

impl HmacKey {
    /// Derive the HMAC key from the platform TPM, or, in development, from a
    /// software key file.
    ///
    /// # Errors
    ///
    /// Returns an error if the TPM is unavailable when required, or if the
    /// software key file is missing, malformed, or the wrong length.
    pub fn derive_from_tpm(config: &TpmConfig) -> Result<Self> {
        if config.use_tpm {
            Self::derive_real_tpm(&config.pcr_indices)
        } else {
            let path = config
                .software_key_path
                .as_ref()
                .ok_or_else(|| anyhow!("software_key_path required when use_tpm=false"))?;
            Self::load_software(path)
        }
    }

    #[cfg(feature = "tpm")]
    fn derive_real_tpm(pcrs: &[u32]) -> Result<Self> {
        let key = crate::crypto_tpm::derive_hmac_key_from_tpm(pcrs)
            .context("deriving HMAC key via TPM 2.0 backend")?;
        Ok(Self { key })
    }

    #[cfg(not(feature = "tpm"))]
    fn derive_real_tpm(pcrs: &[u32]) -> Result<Self> {
        Err(anyhow!(
            "real TPM backend is compiled-out in this build (PCRs requested: {pcrs:?}); \
             either rebuild with `cargo build --features tpm` or set tpm.use_tpm=false for development"
        ))
    }

    fn load_software(path: &std::path::Path) -> Result<Self> {
        let bytes = std::fs::read(path).with_context(|| {
            format!(
                "reading software key from {} — file must contain exactly 32 bytes",
                path.display()
            )
        })?;
        if bytes.len() != 32 {
            return Err(anyhow!(
                "software key must be 32 bytes, found {}",
                bytes.len()
            ));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Ok(Self { key })
    }

    /// Generate a fresh random key. Used only in tests.
    #[cfg(test)]
    pub fn random() -> Self {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        Self { key }
    }

    /// Compute HMAC-SHA256 over the given message.
    ///
    /// # Panics
    ///
    /// Does not panic; `HmacSha256::new_from_slice` is infallible for any
    /// byte slice.
    #[must_use]
    pub fn sign(&self, message: &[u8]) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("HMAC key is valid");
        mac.update(message);
        let result = mac.finalize().into_bytes();
        let mut out = [0u8; 32];
        out.copy_from_slice(&result);
        out
    }

    /// Verify an HMAC in constant time.
    #[must_use]
    pub fn verify(&self, message: &[u8], expected: &[u8; 32]) -> bool {
        let actual = self.sign(message);
        actual.ct_eq(expected).unwrap_u8() == 1
    }
}

/// Canonical event serialization for HMAC input.
///
/// Format (big-endian): u64 nonce || u64 ts_mono_ns || u8 kind || u32 len || payload.
#[must_use]
pub fn canonical_event_bytes(nonce: u64, ts_mono_ns: u64, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(8 + 8 + 1 + 4 + payload.len());
    buf.extend_from_slice(&nonce.to_be_bytes());
    buf.extend_from_slice(&ts_mono_ns.to_be_bytes());
    buf.push(kind);
    buf.extend_from_slice(&u32::try_from(payload.len()).unwrap_or(u32::MAX).to_be_bytes());
    buf.extend_from_slice(payload);
    buf
}

/// Strictly monotonic nonce generator for a single session.
pub struct NonceGenerator {
    counter: AtomicU64,
}

impl NonceGenerator {
    /// Start from 1 (0 is reserved as "unassigned").
    #[must_use]
    pub const fn new() -> Self {
        Self {
            counter: AtomicU64::new(1),
        }
    }

    /// Return the next nonce.
    pub fn next(&self) -> u64 {
        self.counter.fetch_add(1, Ordering::Relaxed)
    }
}

impl Default for NonceGenerator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_and_verify_roundtrip() {
        let key = HmacKey::random();
        let msg = b"hello world";
        let tag = key.sign(msg);
        assert!(key.verify(msg, &tag));
    }

    #[test]
    fn verify_rejects_tamper() {
        let key = HmacKey::random();
        let tag = key.sign(b"hello");
        assert!(!key.verify(b"hellO", &tag));
    }

    #[test]
    fn canonical_bytes_are_stable() {
        let a = canonical_event_bytes(1, 123, 2, b"xyz");
        let b = canonical_event_bytes(1, 123, 2, b"xyz");
        assert_eq!(a, b);
    }

    #[test]
    fn nonce_monotonic() {
        let gen = NonceGenerator::new();
        let mut prev = 0;
        for _ in 0..100 {
            let n = gen.next();
            assert!(n > prev);
            prev = n;
        }
    }
}
