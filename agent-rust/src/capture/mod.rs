//! Capture subsystem.
//!
//! Each platform-specific capture module exposes a `spawn` function that
//! returns a `CaptureHandle`. The handle owns the background thread and
//! supports graceful shutdown.
//!
//! All capture modules share one invariant: they never block on I/O. They
//! push into the ring buffer with bounded latency and drop oldest on
//! overflow.

pub mod keystroke;
pub mod mouse;
pub mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::task::JoinHandle;

/// Handle returned by every capture `spawn`. Dropping the handle does not
/// stop the thread; call `shutdown` explicitly.
pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    task: Option<JoinHandle<()>>,
}

impl CaptureHandle {
    pub(crate) fn new(stop: Arc<AtomicBool>, task: JoinHandle<()>) -> Self {
        Self {
            stop,
            task: Some(task),
        }
    }

    /// Request a graceful stop and await the background task.
    pub async fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

/// Monotonic timestamp in nanoseconds since the agent started.
///
/// Uses `CLOCK_MONOTONIC_RAW` on Linux via `std::time::Instant`, which is not
/// subject to NTP adjustments. On other platforms `Instant` is also
/// monotonic, though the underlying clock may differ.
pub fn monotonic_ns() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
}
