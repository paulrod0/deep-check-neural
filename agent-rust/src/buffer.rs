//! In-memory ring buffer for captured events.
//!
//! The ring buffer is bounded — when full, the oldest events are dropped to
//! keep memory usage predictable. Dropped events are counted and reported in
//! telemetry so a flood attack (D1 in the threat model) is observable.
//!
//! All events are zeroed on drop so that a live memory dump after the agent
//! exits reveals nothing.

use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A single captured event, already signed with the session HMAC key.
///
/// The raw event payload is opaque to the buffer; it is serialized protobuf
/// produced by the capture module.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SignedEvent {
    /// Session-relative monotonic nonce. Strictly monotonic.
    pub nonce: u64,
    /// Monotonic timestamp in nanoseconds since agent start.
    pub ts_mono_ns: u64,
    /// Kind tag for quick demultiplexing (1=key, 2=mouse, 3=window, 4=app).
    pub kind: u8,
    /// Serialized protobuf payload.
    pub payload: Vec<u8>,
    /// HMAC-SHA256 over (nonce || ts || kind || payload) using the TPM key.
    pub hmac: [u8; 32],
}

impl std::fmt::Debug for SignedEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SignedEvent")
            .field("nonce", &self.nonce)
            .field("ts_mono_ns", &self.ts_mono_ns)
            .field("kind", &self.kind)
            .field("payload_len", &self.payload.len())
            .finish_non_exhaustive()
    }
}

/// Ring buffer with drop-oldest semantics.
pub struct RingBuffer {
    inner: Mutex<VecDeque<SignedEvent>>,
    capacity: usize,
    dropped: AtomicU64,
    pushed: AtomicU64,
}

impl RingBuffer {
    /// Create a ring buffer with the given capacity.
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: Mutex::new(VecDeque::with_capacity(capacity)),
            capacity,
            dropped: AtomicU64::new(0),
            pushed: AtomicU64::new(0),
        }
    }

    /// Push a new event. If the buffer is full, the oldest event is dropped
    /// and the `dropped` counter is incremented.
    pub fn push(&self, event: SignedEvent) {
        let mut guard = self.inner.lock();
        if guard.len() == self.capacity {
            if let Some(mut old) = guard.pop_front() {
                old.zeroize();
            }
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
        guard.push_back(event);
        self.pushed.fetch_add(1, Ordering::Relaxed);
    }

    /// Drain up to `n` events from the front of the buffer.
    pub fn drain(&self, n: usize) -> Vec<SignedEvent> {
        let mut guard = self.inner.lock();
        let take = n.min(guard.len());
        guard.drain(0..take).collect()
    }

    /// Number of events currently in the buffer.
    pub fn len(&self) -> usize {
        self.inner.lock().len()
    }

    /// Whether the buffer is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Total number of events pushed since creation.
    pub fn pushed_total(&self) -> u64 {
        self.pushed.load(Ordering::Relaxed)
    }

    /// Total number of events dropped since creation.
    pub fn dropped_total(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(nonce: u64) -> SignedEvent {
        SignedEvent {
            nonce,
            ts_mono_ns: nonce * 1_000,
            kind: 1,
            payload: vec![0u8; 8],
            hmac: [0u8; 32],
        }
    }

    #[test]
    fn push_and_drain() {
        let rb = RingBuffer::new(4);
        for i in 0..3 {
            rb.push(make(i));
        }
        assert_eq!(rb.len(), 3);
        let drained = rb.drain(10);
        assert_eq!(drained.len(), 3);
        assert!(rb.is_empty());
        assert_eq!(rb.dropped_total(), 0);
    }

    #[test]
    fn drop_oldest_on_overflow() {
        let rb = RingBuffer::new(2);
        rb.push(make(1));
        rb.push(make(2));
        rb.push(make(3));
        let drained = rb.drain(10);
        assert_eq!(drained.len(), 2);
        // Oldest (nonce=1) must have been dropped.
        assert_eq!(drained[0].nonce, 2);
        assert_eq!(drained[1].nonce, 3);
        assert_eq!(rb.dropped_total(), 1);
    }
}
