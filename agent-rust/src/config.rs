//! Configuration loading for the BPAS agent.
//!
//! Configuration is read from `/etc/bpas/agent.toml` by default, overridable
//! with `BPAS_CONFIG=...`. Environment variables prefixed with `BPAS_` can
//! override individual fields (e.g. `BPAS_TRANSPORT__ENDPOINT=...`).

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::PathBuf;

/// Top-level agent configuration.
#[derive(Debug, Clone, Deserialize)]
pub struct AgentConfig {
    /// Maximum number of events the in-memory ring buffer can hold before
    /// the oldest events are dropped.
    #[serde(default = "default_buffer_capacity")]
    pub buffer_capacity: usize,

    /// TPM-related settings (or the software fallback).
    pub tpm: TpmConfig,

    /// How to reach the inference worker.
    pub transport: TransportConfig,

    /// Capture subsystem settings.
    #[serde(default)]
    pub capture: CaptureConfig,
}

/// TPM / hardware-backed key derivation settings.
#[derive(Debug, Clone, Deserialize)]
pub struct TpmConfig {
    /// When `true`, use the platform TPM. When `false`, derive the HMAC key
    /// from a local file — only acceptable in development.
    #[serde(default = "default_true")]
    pub use_tpm: bool,

    /// Path to a software key file used when `use_tpm = false`.
    #[serde(default)]
    pub software_key_path: Option<PathBuf>,

    /// PCR indices to include in the key derivation policy.
    #[serde(default = "default_pcrs")]
    pub pcr_indices: Vec<u32>,
}

/// Transport-layer settings.
#[derive(Debug, Clone, Deserialize)]
pub struct TransportConfig {
    /// `https://host:port` of the inference worker.
    pub endpoint: String,

    /// Client certificate (PEM) used for mTLS.
    pub client_cert: PathBuf,

    /// Client private key (PEM) used for mTLS.
    pub client_key: PathBuf,

    /// CA certificate (PEM) that signs the server certificate.
    pub server_ca: PathBuf,

    /// Target maximum time between two uploads, in milliseconds. Smaller
    /// values trade bandwidth and server load for detection latency.
    #[serde(default = "default_flush_interval_ms")]
    pub flush_interval_ms: u64,

    /// Maximum batch size (events) before a forced flush.
    #[serde(default = "default_max_batch")]
    pub max_batch: usize,
}

/// Capture subsystem settings.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct CaptureConfig {
    /// When `true`, do not capture modifier-only presses to reduce noise.
    #[serde(default = "default_true")]
    pub skip_bare_modifiers: bool,

    /// When `true`, capture mouse movement events (125 Hz decimated to 50 Hz).
    #[serde(default = "default_true")]
    pub capture_mouse_movement: bool,

    /// When `true`, capture window focus changes.
    #[serde(default = "default_true")]
    pub capture_window_events: bool,
}

const fn default_true() -> bool {
    true
}
const fn default_buffer_capacity() -> usize {
    4096
}
const fn default_flush_interval_ms() -> u64 {
    1000
}
const fn default_max_batch() -> usize {
    256
}
fn default_pcrs() -> Vec<u32> {
    vec![0, 2, 7]
}

impl AgentConfig {
    /// Load configuration from the canonical path, falling back to environment
    /// variable overrides.
    ///
    /// # Errors
    ///
    /// Returns an error if the file is missing, malformed, or the overrides
    /// cannot be applied.
    pub fn load() -> Result<Self> {
        let path = std::env::var("BPAS_CONFIG").unwrap_or_else(|_| "/etc/bpas/agent.toml".into());

        let cfg = config::Config::builder()
            .add_source(config::File::with_name(&path).required(false))
            .add_source(
                config::Environment::with_prefix("BPAS")
                    .separator("__")
                    .try_parsing(true),
            )
            .build()
            .context("building config")?;

        cfg.try_deserialize::<Self>().context("deserializing config")
    }
}
