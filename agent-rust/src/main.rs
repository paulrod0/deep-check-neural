//! BPAS endpoint agent — main entry point.
//!
//! Captures keystroke and mouse events locally, signs them with a TPM-derived
//! HMAC key, and streams batched embeddings to the inference worker over mTLS.
//!
//! Design principles:
//! - Raw events never leave this process. Only aggregated, signed batches go
//!   over the network, and the network payload contains embeddings, not raw
//!   timing data.
//! - Memory is locked (mlock) and zeroed on drop to reduce the attack surface
//!   of a live memory dump.
//! - A monotonic clock is used for all timestamps; the system wall clock is
//!   never trusted.
//! - The process runs with minimum privileges, a restricted seccomp-bpf
//!   profile on Linux, and no file-system writes outside a small state dir.

#![warn(clippy::pedantic, clippy::nursery)]
#![allow(clippy::module_name_repetitions)]

mod buffer;
mod capture;
mod config;
mod crypto;
#[cfg(feature = "tpm")]
mod crypto_tpm;
mod transport;

use anyhow::{Context, Result};
use std::sync::Arc;
use tokio::signal;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::buffer::RingBuffer;
use crate::config::AgentConfig;
use crate::crypto::HmacKey;
use crate::transport::InferenceClient;

/// Program entry point.
///
/// # Errors
///
/// Propagates any fatal configuration, cryptographic, or transport error.
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<()> {
    init_tracing();

    let config = AgentConfig::load().context("loading agent configuration")?;
    info!(version = env!("CARGO_PKG_VERSION"), "bpas-agent starting");

    // Lock memory so RAM cannot be swapped to disk.
    #[cfg(target_os = "linux")]
    lock_memory()?;

    // Derive the session HMAC key from the TPM (or the software fallback in
    // dev mode). `HmacKey` zeroes itself on drop.
    let hmac_key =
        Arc::new(HmacKey::derive_from_tpm(&config.tpm).context("deriving HMAC key from TPM")?);

    let session_id = uuid::Uuid::new_v4();
    info!(%session_id, "session started");

    // Ring buffer that absorbs bursts without blocking the capture hooks.
    let buffer = Arc::new(RingBuffer::new(config.buffer_capacity));

    // Spawn capture threads. They only *push* to the buffer — they must never
    // block on network I/O.
    let keystroke_handle =
        capture::keystroke::spawn(Arc::clone(&buffer), session_id, Arc::clone(&hmac_key))?;
    let mouse_handle =
        capture::mouse::spawn(Arc::clone(&buffer), session_id, Arc::clone(&hmac_key))?;
    let window_handle =
        capture::window::spawn(Arc::clone(&buffer), session_id, Arc::clone(&hmac_key))?;

    // Transport layer: consumes batches from the buffer and ships them to the
    // inference worker.
    let client = InferenceClient::connect(&config.transport).await?;
    let transport_handle = transport::run_shipping_loop(client, Arc::clone(&buffer), session_id);

    // Graceful shutdown on SIGINT/SIGTERM.
    let shutdown = async {
        tokio::select! {
            _ = signal::ctrl_c() => warn!("received SIGINT, shutting down"),
            () = wait_sigterm() => warn!("received SIGTERM, shutting down"),
        }
    };

    tokio::select! {
        res = transport_handle => {
            if let Err(e) = res {
                error!(error = ?e, "transport loop exited with error");
            }
        }
        () = shutdown => {}
    }

    info!("draining capture threads");
    keystroke_handle.shutdown().await;
    mouse_handle.shutdown().await;
    window_handle.shutdown().await;

    info!("bpas-agent stopped");
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::registry()
        .with(fmt::layer().json().with_target(true))
        .with(filter)
        .init();
}

#[cfg(target_os = "linux")]
fn lock_memory() -> Result<()> {
    use nix::sys::mman::{mlockall, MlockAllFlags};
    mlockall(MlockAllFlags::MCL_CURRENT | MlockAllFlags::MCL_FUTURE)
        .context("mlockall failed — run with CAP_IPC_LOCK or increase RLIMIT_MEMLOCK")?;
    info!("memory locked with mlockall");
    Ok(())
}

#[cfg(target_os = "linux")]
async fn wait_sigterm() {
    use tokio::signal::unix::{signal, SignalKind};
    if let Ok(mut stream) = signal(SignalKind::terminate()) {
        stream.recv().await;
    }
}

#[cfg(not(target_os = "linux"))]
async fn wait_sigterm() {
    // On non-Linux platforms, wait forever (Ctrl-C is handled separately).
    std::future::pending::<()>().await;
}
