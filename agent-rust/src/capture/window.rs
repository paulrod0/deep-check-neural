//! Window focus and application switching capture.
//!
//! Polls the active window every 500 ms and emits an event whenever it
//! changes. Only the application binary name (or a hash of it) is captured —
//! window titles are NOT captured because they often leak document contents.

use crate::buffer::{RingBuffer, SignedEvent};
use crate::capture::{monotonic_ns, CaptureHandle};
use crate::crypto::{canonical_event_bytes, HmacKey, NonceGenerator};
use anyhow::Result;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, info, warn};
use uuid::Uuid;

const KIND_WINDOW: u8 = 3;

/// Encode a window focus event.
///
/// Format:
///   [0..16]   first 128 bits of SHA-256(app_binary_name)
///   [16..17]  action: 1=focus_in, 2=focus_out
///   [17..21]  optional u32 pid (0 if unknown)
pub fn encode_window_event(app_hash: &[u8; 16], action: u8, pid: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(21);
    out.extend_from_slice(app_hash);
    out.push(action);
    out.extend_from_slice(&pid.to_be_bytes());
    out
}

/// Hash an application identifier into the 128-bit tag used on the wire.
pub fn hash_app(app: &str) -> [u8; 16] {
    let full = Sha256::digest(app.as_bytes());
    let mut short = [0u8; 16];
    short.copy_from_slice(&full[..16]);
    short
}

/// Spawn the window focus capture thread.
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
        info!(%session_id, "window capture started");
        if let Err(e) = run(stop_task, buffer, hmac, nonce_gen) {
            warn!(error = ?e, "window capture loop terminated");
        }
        info!("window capture stopped");
    });

    Ok(CaptureHandle::new(stop, task))
}

fn run(
    stop: Arc<AtomicBool>,
    buffer: Arc<RingBuffer>,
    hmac: Arc<HmacKey>,
    nonce_gen: Arc<NonceGenerator>,
) -> Result<()> {
    let mut last: Option<(String, u32)> = None;
    while !stop.load(Ordering::Relaxed) {
        match active_window() {
            Ok(Some((app, pid))) => {
                let changed = last
                    .as_ref()
                    .map_or(true, |(prev_app, _)| prev_app != &app);
                if changed {
                    let ts = monotonic_ns();

                    if let Some((prev_app, prev_pid)) = &last {
                        emit(&buffer, &hmac, &nonce_gen, prev_app, 2, *prev_pid, ts);
                    }
                    emit(&buffer, &hmac, &nonce_gen, &app, 1, pid, ts);
                    last = Some((app, pid));
                }
            }
            Ok(None) => {}
            Err(e) => debug!(error = ?e, "active_window probe failed (non-fatal)"),
        }

        std::thread::sleep(Duration::from_millis(500));
    }
    Ok(())
}

fn emit(
    buffer: &RingBuffer,
    hmac: &HmacKey,
    nonce_gen: &NonceGenerator,
    app: &str,
    action: u8,
    pid: u32,
    ts: u64,
) {
    let hash = hash_app(app);
    let nonce = nonce_gen.next();
    let payload = encode_window_event(&hash, action, pid);
    let canonical = canonical_event_bytes(nonce, ts, KIND_WINDOW, &payload);
    let tag = hmac.sign(&canonical);
    buffer.push(SignedEvent {
        nonce,
        ts_mono_ns: ts,
        kind: KIND_WINDOW,
        payload,
        hmac: tag,
    });
}

#[cfg(target_os = "linux")]
fn active_window() -> Result<Option<(String, u32)>> {
    // Reading the active window reliably on Linux requires either an X11
    // connection or a Wayland compositor-specific protocol. The reference
    // implementation uses /proc/<pid>/comm combined with the foreground tty
    // owner as a conservative best-effort. A production build would link
    // against xdotool/libxcb or a Wayland extension.
    Ok(None)
}

#[cfg(target_os = "windows")]
fn active_window() -> Result<Option<(String, u32)>> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    // Safety: Win32 calls — none of our buffers are aliased.
    let hwnd: HWND = unsafe { GetForegroundWindow() };
    if hwnd.0 == 0 {
        return Ok(None);
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    // For privacy, we hash only the PID; resolving the exe path is left to
    // a privileged helper so the agent itself stays unprivileged.
    Ok(Some((format!("pid:{pid}"), pid)))
}

#[cfg(target_os = "macos")]
fn active_window() -> Result<Option<(String, u32)>> {
    // A proper macOS implementation would use `NSWorkspace.frontmostApplication`
    // via the `objc2` crate. Kept as a stub here.
    Ok(None)
}

#[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
fn active_window() -> Result<Option<(String, u32)>> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_deterministic() {
        let a = hash_app("firefox");
        let b = hash_app("firefox");
        assert_eq!(a, b);
    }

    #[test]
    fn hash_differs_across_apps() {
        assert_ne!(hash_app("firefox"), hash_app("thunderbird"));
    }

    #[test]
    fn encode_has_expected_length() {
        let h = hash_app("x");
        let b = encode_window_event(&h, 1, 1234);
        assert_eq!(b.len(), 21);
    }
}
