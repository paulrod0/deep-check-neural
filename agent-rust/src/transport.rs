//! Transport layer — ships batched events to the inference worker over mTLS.
//!
//! The shipping loop:
//!   1. Waits until `flush_interval_ms` elapses OR the buffer hits `max_batch`.
//!   2. Drains up to `max_batch` events from the ring buffer.
//!   3. Serializes them into a framed payload: len-prefixed repeated events.
//!   4. Sends the payload over an mTLS-authenticated TLS connection.
//!   5. On failure, keeps the session open and retries with exponential
//!      back-off (capped at 30 s). Events accumulate in the buffer meanwhile
//!      and may be dropped per §D1 of the threat model.
//!
//! The transport never reassembles raw events into recoverable text — it
//! only forwards already-signed binary blobs. Even a compromised worker
//! would only see what passed through the ring buffer.

use crate::buffer::{RingBuffer, SignedEvent};
use crate::config::TransportConfig;
use anyhow::{anyhow, Context, Result};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::task::JoinHandle;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName};
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::TlsConnector;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// An owned TLS client socket ready to send batches.
pub struct InferenceClient {
    stream: tokio_rustls::client::TlsStream<TcpStream>,
    endpoint: String,
    max_batch: usize,
    flush_interval: Duration,
}

impl InferenceClient {
    /// Connect to the inference worker using the provided mTLS credentials.
    ///
    /// # Errors
    ///
    /// Returns an error if the certificates cannot be loaded, the server is
    /// unreachable, or the TLS handshake fails.
    pub async fn connect(config: &TransportConfig) -> Result<Self> {
        let tls_config = build_client_config(config).await?;
        let connector = TlsConnector::from(Arc::new(tls_config));

        let (host, port) = parse_endpoint(&config.endpoint)?;
        let tcp = TcpStream::connect((host.as_str(), port))
            .await
            .with_context(|| format!("connecting to {host}:{port}"))?;
        tcp.set_nodelay(true).ok();

        let server_name = ServerName::try_from(host.clone())
            .with_context(|| format!("invalid server name: {host}"))?;
        let stream = connector
            .connect(server_name, tcp)
            .await
            .context("TLS handshake failed")?;

        info!(%host, port, "mTLS connected to inference worker");

        Ok(Self {
            stream,
            endpoint: config.endpoint.clone(),
            max_batch: config.max_batch,
            flush_interval: Duration::from_millis(config.flush_interval_ms),
        })
    }

    async fn send_batch(&mut self, batch: &[SignedEvent], session_id: Uuid) -> Result<()> {
        let serialized = serialize_batch(session_id, batch);
        // Frame: 4-byte big-endian length prefix.
        let len = u32::try_from(serialized.len())
            .map_err(|_| anyhow!("batch too large ({} bytes)", serialized.len()))?;
        self.stream.write_all(&len.to_be_bytes()).await?;
        self.stream.write_all(&serialized).await?;
        self.stream.flush().await?;
        Ok(())
    }
}

async fn build_client_config(config: &TransportConfig) -> Result<ClientConfig> {
    let ca_pem = tokio::fs::read(&config.server_ca)
        .await
        .with_context(|| format!("reading server CA {}", config.server_ca.display()))?;
    let client_cert_pem = tokio::fs::read(&config.client_cert)
        .await
        .with_context(|| format!("reading client cert {}", config.client_cert.display()))?;
    let client_key_pem = tokio::fs::read(&config.client_key)
        .await
        .with_context(|| format!("reading client key {}", config.client_key.display()))?;

    let mut roots = RootCertStore::empty();
    for cert in rustls_pemfile::certs(&mut ca_pem.as_slice()) {
        let cert = cert.context("invalid PEM in server CA file")?;
        roots
            .add(cert)
            .context("adding CA certificate to root store")?;
    }

    let certs: Vec<CertificateDer<'static>> =
        rustls_pemfile::certs(&mut client_cert_pem.as_slice())
            .collect::<Result<Vec<_>, _>>()
            .context("parsing client certs")?;

    let key = rustls_pemfile::private_key(&mut client_key_pem.as_slice())
        .context("reading client key")?
        .ok_or_else(|| anyhow!("no PEM-encoded private key in client key file"))?;

    ClientConfig::builder()
        .with_root_certificates(roots)
        .with_client_auth_cert(certs, PrivateKeyDer::from(key))
        .context("building TLS client config")
}

fn parse_endpoint(endpoint: &str) -> Result<(String, u16)> {
    // Accepts "https://host:port", "host:port", or bare "host" (default 8443).
    let trimmed = endpoint
        .strip_prefix("https://")
        .unwrap_or(endpoint)
        .trim_end_matches('/');
    if let Some((host, port_str)) = trimmed.rsplit_once(':') {
        let port: u16 = port_str
            .parse()
            .with_context(|| format!("invalid port in endpoint: {endpoint}"))?;
        Ok((host.to_string(), port))
    } else {
        Ok((trimmed.to_string(), 8443))
    }
}

/// Serialize a batch into a length-prefixed sequence of events.
///
/// Wire format (all big-endian):
///   [0..16]   session UUID
///   [16..20]  u32 count
///   for each event:
///       [u32] payload length
///       [u8]  kind
///       [u64] nonce
///       [u64] ts_mono_ns
///       [u8;32] hmac
///       [var]  payload bytes
fn serialize_batch(session_id: Uuid, batch: &[SignedEvent]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(20 + batch.len() * 64);
    buf.extend_from_slice(session_id.as_bytes());
    let count = u32::try_from(batch.len()).unwrap_or(u32::MAX);
    buf.extend_from_slice(&count.to_be_bytes());
    for ev in batch {
        let plen = u32::try_from(ev.payload.len()).unwrap_or(u32::MAX);
        buf.extend_from_slice(&plen.to_be_bytes());
        buf.push(ev.kind);
        buf.extend_from_slice(&ev.nonce.to_be_bytes());
        buf.extend_from_slice(&ev.ts_mono_ns.to_be_bytes());
        buf.extend_from_slice(&ev.hmac);
        buf.extend_from_slice(&ev.payload);
    }
    buf
}

/// Run the shipping loop until an unrecoverable error occurs or the client
/// disconnects permanently. Returns a `JoinHandle` the caller can `.await`.
pub fn run_shipping_loop(
    client: InferenceClient,
    buffer: Arc<RingBuffer>,
    session_id: Uuid,
) -> JoinHandle<Result<()>> {
    tokio::spawn(async move {
        let mut client = client;
        let mut backoff = Duration::from_millis(100);
        loop {
            let ticker = tokio::time::sleep(client.flush_interval);
            tokio::pin!(ticker);

            tokio::select! {
                () = &mut ticker => {}
                () = buffer_has_min(Arc::clone(&buffer), client.max_batch) => {}
            }

            let batch = buffer.drain(client.max_batch);
            if batch.is_empty() {
                continue;
            }
            let batch_len = batch.len();

            match client.send_batch(&batch, session_id).await {
                Ok(()) => {
                    debug!(batch_len, "batch sent");
                    backoff = Duration::from_millis(100);
                }
                Err(e) => {
                    warn!(error = ?e, endpoint = %client.endpoint, "send failed, backing off");
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_secs(30));
                }
            }
        }
    })
}

/// Resolves when the buffer has at least `min` events. Polls at 20 Hz rather
/// than using a notifier to keep `RingBuffer` free of async machinery.
async fn buffer_has_min(buffer: Arc<RingBuffer>, min: usize) {
    loop {
        if buffer.len() >= min {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_endpoint_variants() {
        assert_eq!(
            parse_endpoint("https://host.internal:9443").unwrap(),
            ("host.internal".to_string(), 9443)
        );
        assert_eq!(
            parse_endpoint("10.0.0.1:8443").unwrap(),
            ("10.0.0.1".to_string(), 8443)
        );
        assert_eq!(
            parse_endpoint("worker").unwrap(),
            ("worker".to_string(), 8443)
        );
    }

    #[test]
    fn serialize_batch_layout() {
        let sid = Uuid::nil();
        let events = vec![SignedEvent {
            nonce: 1,
            ts_mono_ns: 2,
            kind: 3,
            payload: vec![0xAA, 0xBB],
            hmac: [0u8; 32],
        }];
        let buf = serialize_batch(sid, &events);
        // 16 UUID + 4 count + 4 plen + 1 kind + 8 nonce + 8 ts + 32 hmac + 2 payload = 75
        assert_eq!(buf.len(), 75);
        // Count == 1
        assert_eq!(&buf[16..20], &[0, 0, 0, 1]);
        // Kind byte at offset 24
        assert_eq!(buf[24], 3);
    }
}
