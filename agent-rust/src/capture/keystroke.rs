//! Keystroke capture.
//!
//! On Linux, reads evdev keyboard devices and emits `KeyEvent { keycode,
//! pressed, ts_mono_ns }` for every key down / up. On other platforms a
//! stub emits nothing so the agent still compiles.
//!
//! Raw `keycode` and `pressed` are the only fields captured. We do NOT
//! capture the text that the user is typing — that would be the one thing we
//! are trying to protect.

use crate::buffer::{RingBuffer, SignedEvent};
use crate::capture::{monotonic_ns, CaptureHandle};
use crate::crypto::{canonical_event_bytes, HmacKey, NonceGenerator};
use anyhow::Result;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Protobuf-like payload for a keystroke event.
///
/// Fields:
///   u16 keycode         hardware key code (Linux KEY_* or Windows VK_*).
///   u8  pressed         1 for down, 0 for up.
///   u8  reserved        always 0 (alignment).
///   u32 flags           bitmask — modifier state at the time of the event.
///
/// We serialize manually rather than pulling in a full prost build pipeline,
/// so the format is documented here explicitly.
pub fn encode_key_event(keycode: u16, pressed: bool, flags: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(8);
    out.extend_from_slice(&keycode.to_be_bytes());
    out.push(u8::from(pressed));
    out.push(0); // reserved
    out.extend_from_slice(&flags.to_be_bytes());
    out
}

const KIND_KEY: u8 = 1;

/// Spawn the keystroke capture thread.
///
/// # Errors
///
/// Returns an error only if spawning the OS-level listener fails at startup.
/// Transient read errors are logged and the thread keeps running.
pub fn spawn(
    buffer: Arc<RingBuffer>,
    session_id: Uuid,
    hmac: Arc<HmacKey>,
) -> Result<CaptureHandle> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_task = Arc::clone(&stop);
    let nonce_gen = Arc::new(NonceGenerator::new());

    let task = tokio::task::spawn_blocking(move || {
        info!(%session_id, "keystroke capture started");
        if let Err(e) = run(stop_task, buffer, hmac, nonce_gen) {
            warn!(error = ?e, "keystroke capture loop terminated");
        }
        info!("keystroke capture stopped");
    });

    Ok(CaptureHandle::new(stop, task))
}

#[cfg(target_os = "linux")]
fn run(
    stop: Arc<AtomicBool>,
    buffer: Arc<RingBuffer>,
    hmac: Arc<HmacKey>,
    nonce_gen: Arc<NonceGenerator>,
) -> Result<()> {
    use evdev::{Device, EventType};
    use std::path::PathBuf;

    // Enumerate evdev devices; pick the ones that expose EV_KEY (keyboards).
    // We're permissive here: any device that reports EV_KEY support qualifies,
    // which the kernel sets for both real keyboards and uinput keyboards.
    let devices: Vec<(PathBuf, Device)> = evdev::enumerate()
        .filter(|(_, d)| d.supported_events().contains(EventType::KEY))
        .collect();

    if devices.is_empty() {
        warn!("no keyboard evdev devices found — keystroke capture disabled");
        return Ok(());
    }

    info!(count = devices.len(), "keyboard devices discovered");

    // Round-robin polling — we read one event from each device per loop
    // iteration to avoid starving slow ones. A real deployment would use
    // epoll; this is kept simple for the reference implementation.
    let mut devs: Vec<Device> = devices.into_iter().map(|(_, d)| d).collect();
    while !stop.load(Ordering::Relaxed) {
        let mut activity = false;
        for dev in &mut devs {
            match dev.fetch_events() {
                Ok(events) => {
                    for ev in events {
                        if ev.event_type() == EventType::KEY {
                            let pressed = ev.value() != 0;
                            let keycode = ev.code();
                            let flags: u32 = 0;
                            let ts = monotonic_ns();
                            let nonce = nonce_gen.next();
                            let payload = encode_key_event(keycode, pressed, flags);
                            let canonical =
                                canonical_event_bytes(nonce, ts, KIND_KEY, &payload);
                            let tag = hmac.sign(&canonical);
                            buffer.push(SignedEvent {
                                nonce,
                                ts_mono_ns: ts,
                                kind: KIND_KEY,
                                payload,
                                hmac: tag,
                            });
                            activity = true;
                        }
                    }
                }
                Err(e) if e.raw_os_error() == Some(11) /* EAGAIN */ => {}
                Err(e) => {
                    debug!(error = ?e, "evdev read error (non-fatal)");
                }
            }
        }
        if !activity {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn run(
    stop: Arc<AtomicBool>,
    _buffer: Arc<RingBuffer>,
    _hmac: Arc<HmacKey>,
    _nonce_gen: Arc<NonceGenerator>,
) -> Result<()> {
    warn!("keystroke capture is a stub on this platform; implement per-OS hook");
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_roundtrip_fields() {
        let bytes = encode_key_event(0x1234, true, 0xDEAD_BEEF);
        assert_eq!(bytes.len(), 8);
        assert_eq!(&bytes[0..2], &[0x12, 0x34]);
        assert_eq!(bytes[2], 1);
        assert_eq!(bytes[3], 0);
        assert_eq!(&bytes[4..8], &[0xDE, 0xAD, 0xBE, 0xEF]);
    }

    #[test]
    fn encode_down_vs_up() {
        let down = encode_key_event(0x20, true, 0);
        let up = encode_key_event(0x20, false, 0);
        assert_ne!(down, up);
    }
}
