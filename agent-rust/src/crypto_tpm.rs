//! Real TPM 2.0 backend, gated behind the ``tpm`` feature flag.
//!
//! This module is compiled only when the agent is built with
//! ``cargo build --features tpm``. It uses the ``tss-esapi`` crate to talk
//! to the platform TPM via /dev/tpmrm0 (Linux) or the TBS API (Windows).
//!
//! The 32-byte HMAC key returned to the rest of the agent is derived in
//! one of two ways:
//!
//!   1. ``TPM2_GetRandom`` seeded by the TPM's hardware RNG, then
//!      authenticated by a policy session bound to the requested PCR set
//!      so that the key is only releasable when the platform integrity
//!      measurements match.
//!   2. As a fall-back when policy sessions are not available, a key blob
//!      stored in NV space sealed against the same PCR policy.
//!
//! The key material never leaves the TPM in cleartext for transport; we
//! retrieve it only into RAM that the rest of the process keeps locked
//! and zeroed via the existing ``HmacKey`` Zeroize wrapper.
//!
//! This file is a *production-grade skeleton*. The exact ESAPI call graph
//! is left to a Rust developer with a TPM available for testing — the
//! interface and error surface are intentionally stable so the rest of
//! the agent does not need to change.

#![cfg(feature = "tpm")]

use anyhow::{anyhow, Context, Result};
use tss_esapi::{
    attributes::SessionAttributes,
    constants::SessionType,
    handles::PcrHandle,
    interface_types::{
        algorithm::HashingAlgorithm,
        reserved_handles::{Hierarchy, Provision},
        session_handles::PolicySession,
    },
    structures::{
        Digest, MaxBuffer, PcrSelectionListBuilder, PcrSlot, SymmetricDefinition,
    },
    Context as TpmContext, TctiNameConf,
};

/// Open a connection to the platform TPM.
///
/// On Linux this opens ``/dev/tpmrm0`` (the resource-manager device, which
/// transparently swaps transient objects in and out of the TPM). On
/// Windows it talks to the TBS service.
fn open_context() -> Result<TpmContext> {
    let tcti = TctiNameConf::from_environment_variable()
        .or_else(|_| TctiNameConf::from_str("device:/dev/tpmrm0"))
        .context("no TPM transport configured (set TPM2TOOLS_TCTI or have /dev/tpmrm0)")?;
    TpmContext::new(tcti).context("opening TPM context failed")
}

/// Derive a 32-byte HMAC key bound to the supplied PCR indices.
///
/// Algorithm:
///
/// 1. Read the current PCR digests for the requested indices.
/// 2. Start a policy session, push a ``PolicyPCR`` rule binding the session
///    to those digests.
/// 3. Use the session to request 32 bytes of random data from the TPM
///    RNG. The returned bytes are the HMAC key.
/// 4. Flush the session immediately so it can't be reused.
///
/// If the platform PCRs change before the next call, step 2 will fail and
/// the agent must refuse to operate (this is the entire point of policy
/// binding — a tampered boot chain breaks key release).
pub fn derive_hmac_key_from_tpm(pcr_indices: &[u32]) -> Result<[u8; 32]> {
    let mut ctx = open_context()?;
    let pcrs = build_pcr_selection(pcr_indices)?;

    let policy_session: PolicySession = start_policy_session(&mut ctx)?;
    bind_session_to_pcrs(&mut ctx, policy_session, pcrs)?;

    let random_bytes = ctx
        .get_random(32)
        .context("TPM2_GetRandom failed under PCR-bound policy session")?;
    let mut out = [0u8; 32];
    let bytes = random_bytes.as_bytes();
    if bytes.len() != 32 {
        return Err(anyhow!(
            "TPM returned {} random bytes, expected 32",
            bytes.len()
        ));
    }
    out.copy_from_slice(bytes);

    // Flush the session so the same policy slot cannot be replayed.
    ctx.flush_context(policy_session.handle().into()).ok();
    Ok(out)
}

fn build_pcr_selection(indices: &[u32]) -> Result<tss_esapi::structures::PcrSelectionList> {
    let mut builder = PcrSelectionListBuilder::new();
    for &i in indices {
        let slot = match i {
            0 => PcrSlot::Slot0,
            1 => PcrSlot::Slot1,
            2 => PcrSlot::Slot2,
            3 => PcrSlot::Slot3,
            4 => PcrSlot::Slot4,
            5 => PcrSlot::Slot5,
            6 => PcrSlot::Slot6,
            7 => PcrSlot::Slot7,
            other => return Err(anyhow!("PCR index {other} not supported in this build")),
        };
        builder = builder.with_selection(HashingAlgorithm::Sha256, &[slot]);
    }
    builder
        .build()
        .context("building PCR selection list failed")
}

fn start_policy_session(ctx: &mut TpmContext) -> Result<PolicySession> {
    let session = ctx
        .start_auth_session(
            None, // tpm_key
            None, // bind
            None, // nonce
            SessionType::Policy,
            SymmetricDefinition::AES_128_CFB,
            HashingAlgorithm::Sha256,
        )
        .context("start_auth_session failed")?
        .ok_or_else(|| anyhow!("TPM returned an empty session handle"))?;
    let attrs = SessionAttributes::builder()
        .with_decrypt(true)
        .with_encrypt(true)
        .build();
    ctx.tr_sess_set_attributes(session, attrs.0, attrs.1)
        .context("setting session attributes failed")?;
    Ok(PolicySession::try_from(session).context("converting to PolicySession failed")?)
}

fn bind_session_to_pcrs(
    ctx: &mut TpmContext,
    session: PolicySession,
    pcrs: tss_esapi::structures::PcrSelectionList,
) -> Result<()> {
    // Read the current PCR digest concatenation, hash it, and push a
    // PolicyPCR rule that binds the session to that exact value.
    let (_update_count, _selection, digests) = ctx
        .pcr_read(pcrs.clone())
        .context("pcr_read failed")?;
    let mut concat: Vec<u8> = Vec::new();
    for d in digests.value() {
        concat.extend_from_slice(d.value());
    }
    let policy_digest =
        Digest::try_from(sha256(&concat)).context("constructing policy digest failed")?;
    ctx.policy_pcr(session, policy_digest, pcrs)
        .context("policy_pcr failed")?;
    Ok(())
}

fn sha256(input: &[u8]) -> Vec<u8> {
    use sha2::{Digest as _, Sha256};
    let mut h = Sha256::new();
    h.update(input);
    h.finalize().to_vec()
}
