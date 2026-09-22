//! Mouse dynamics capture.
//!
//! Emits two event kinds:
//!   - Movement samples at 50 Hz (decimated from ~125 Hz input)
//!   - Click and scroll events as they occur
//!
//! Only relative deltas are recorded (Δx, Δy, Δt). Absolute coordinates are
//! not captured since they reveal screen layout, which is out of scope.

use crate::buffer::{RingBuffer, SignedEvent};
use crate::capture::{monotonic_ns, CaptureHandle};
use crate::crypto::{canonical_event_bytes, HmacKey, NonceGenerator};
use anyhow::Result;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

const KIND_MOUSE: u8 = 2;

const DECIMATION_PERIOD_NS: u64 = 20_000_000; // 50 Hz

/// Encode a mouse event.
///
/// Format:
///   u8  subkind       1=move, 2=click_down, 3=click_up, 4=scroll
///   i16 dx            delta x (pixels)
///   i16 dy            delta y (pixels)
///   u32 dt_us         microseconds since last emitted event
///   u8  button        mouse button (only for click subkinds)
///
/// Total 10 bytes per event.
pub fn encode_mouse_event(
    subkind: MouseSubkind,
    dx: i16,
    dy: i16,
    dt_us: u32,
    button: u8,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(10);
    out.push(subkind as u8);
    out.extend_from_slice(&dx.to_be_bytes());
    out.extend_from_slice(&dy.to_be_bytes());
    out.extend_from_slice(&dt_us.to_be_bytes());
    out.push(button);
    out
}

/// Kind of mouse event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MouseSubkind {
    /// Movement sample (decimated).
    Move = 1,
    /// Button press (down transition).
    ClickDown = 2,
    /// Button release (up transition).
    ClickUp = 3,
    /// Scroll wheel tick.
    Scroll = 4,
}

/// Spawn the mouse capture thread.
///
/// # Errors
///
/// Returns an error only if spawning the OS-level listener fails at startup.
pub fn spawn(
    buffer: Arc<RingBuffer>,
    session_id: Uuid,
    hmac: Arc<HmacKey>,
) -> Result<CaptureHandle> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_task = Arc::clone(&stop);
    let nonce_gen = Arc::new(NonceGenerator::new());

    let task = tokio::task::spawn_blocking(move || {
        info!(%session_id, "mouse capture started");
        if let Err(e) = run(stop_task, buffer, hmac, nonce_gen) {
            warn!(error = ?e, "mouse capture loop terminated");
        }
        info!("mouse capture stopped");
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

    // Linux REL axis codes (stable across evdev versions):
    //   0 = REL_X, 1 = REL_Y, 8 = REL_WHEEL.
    const REL_X: u16 = 0;
    const REL_Y: u16 = 1;
    const REL_WHEEL: u16 = 8;

    let devices: Vec<Device> = evdev::enumerate()
        .filter_map(|(_, d)| {
            if d.supported_events().contains(EventType::RELATIVE) {
                Some(d)
            } else {
                None
            }
        })
        .collect();

    if devices.is_empty() {
        warn!("no mouse evdev devices found — mouse capture disabled");
        return Ok(());
    }

    info!(count = devices.len(), "mouse devices discovered");

    let mut devs = devices;
    let mut accum_dx: i32 = 0;
    let mut accum_dy: i32 = 0;
    let mut last_emit_ns = monotonic_ns();

    while !stop.load(Ordering::Relaxed) {
        let mut activity = false;
        for dev in &mut devs {
            match dev.fetch_events() {
                Ok(events) => {
                    for ev in events {
                        activity = true;
                        match ev.event_type() {
                            EventType::RELATIVE => {
                                let value = ev.value();
                                match ev.code() {
                                    REL_X => accum_dx += value,
                                    REL_Y => accum_dy += value,
                                    REL_WHEEL => {
                                        let ts = monotonic_ns();
                                        emit(
                                            &buffer,
                                            &hmac,
                                            &nonce_gen,
                                            MouseSubkind::Scroll,
                                            0,
                                            i16::try_from(value).unwrap_or(0),
                                            0,
                                            0,
                                            ts,
                                        );
                                    }
                                    _ => {}
                                }
                            }
                            EventType::KEY => {
                                let subkind = match ev.value() {
                                    1 => MouseSubkind::ClickDown,
                                    0 => MouseSubkind::ClickUp,
                                    _ => continue,
                                };
                                let ts = monotonic_ns();
                                emit(
                                    &buffer,
                                    &hmac,
                                    &nonce_gen,
                                    subkind,
                                    0,
                                    0,
                                    0,
                                    button_from_code(ev.code()),
                                    ts,
                                );
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => debug!(error = ?e, "mouse evdev read error (non-fatal)"),
            }
        }

        // Decimate movement: emit accumulated deltas at 50 Hz.
        let now = monotonic_ns();
        if now - last_emit_ns >= DECIMATION_PERIOD_NS && (accum_dx != 0 || accum_dy != 0) {
            let dx_clamped = i16::try_from(accum_dx.clamp(i32::from(i16::MIN), i32::from(i16::MAX)))
                .unwrap_or(0);
            let dy_clamped = i16::try_from(accum_dy.clamp(i32::from(i16::MIN), i32::from(i16::MAX)))
                .unwrap_or(0);
            let dt_us = u32::try_from((now - last_emit_ns) / 1_000).unwrap_or(u32::MAX);
            emit(
                &buffer,
                &hmac,
                &nonce_gen,
                MouseSubkind::Move,
                dx_clamped,
                dy_clamped,
                dt_us,
                0,
                now,
            );
            accum_dx = 0;
            accum_dy = 0;
            last_emit_ns = now;
        }

        if !activity {
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
const fn button_from_code(code: u16) -> u8 {
    // Map common evdev button codes to our 0..=3 vocabulary:
    //   272 = BTN_LEFT   -> 1
    //   273 = BTN_RIGHT  -> 2
    //   274 = BTN_MIDDLE -> 3
    match code {
        272 => 1,
        273 => 2,
        274 => 3,
        _ => 0,
    }
}

#[cfg(target_os = "linux")]
fn emit(
    buffer: &RingBuffer,
    hmac: &HmacKey,
    nonce_gen: &NonceGenerator,
    subkind: MouseSubkind,
    dx: i16,
    dy: i16,
    dt_us: u32,
    button: u8,
    ts: u64,
) {
    let nonce = nonce_gen.next();
    let payload = encode_mouse_event(subkind, dx, dy, dt_us, button);
    let canonical = canonical_event_bytes(nonce, ts, KIND_MOUSE, &payload);
    let tag = hmac.sign(&canonical);
    buffer.push(SignedEvent {
        nonce,
        ts_mono_ns: ts,
        kind: KIND_MOUSE,
        payload,
        hmac: tag,
    });
}

#[cfg(not(target_os = "linux"))]
fn run(
    stop: Arc<AtomicBool>,
    _buffer: Arc<RingBuffer>,
    _hmac: Arc<HmacKey>,
    _nonce_gen: Arc<NonceGenerator>,
) -> Result<()> {
    warn!("mouse capture is a stub on this platform; implement per-OS hook");
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_has_expected_length() {
        let bytes = encode_mouse_event(MouseSubkind::Move, 10, -10, 20_000, 0);
        assert_eq!(bytes.len(), 10);
    }

    #[test]
    fn subkind_tag_is_stable() {
        let bytes = encode_mouse_event(MouseSubkind::ClickDown, 0, 0, 0, 1);
        assert_eq!(bytes[0], MouseSubkind::ClickDown as u8);
    }

    #[test]
    fn dx_negative_encoded_correctly() {
        let bytes = encode_mouse_event(MouseSubkind::Move, -1, 0, 0, 0);
        // -1 big-endian i16 = 0xFFFF
        assert_eq!(&bytes[1..3], &[0xFF, 0xFF]);
    }
}
