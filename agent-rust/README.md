# BPAS Agent (Rust)

Endpoint agent for Deep-Check's Behaviour Pattern Authentication System.

Captures keystroke, mouse and window-focus events locally, signs them with a
TPM-derived HMAC key, and ships batches to the inference worker over mTLS.

## Design summary

- **Raw events never leave the process.** Only short HMAC-signed binary blobs
  are sent, and they are non-human-readable (keycodes, not text).
- **Zero-allocation capture path.** Keystroke / mouse threads push into a
  ring buffer and never touch the network.
- **Memory-locked (mlock) on Linux**, so captured events cannot be paged out
  to disk.
- **Keys are zeroed on drop** via `zeroize` — a process-wide memory dump
  after exit reveals nothing.
- **Monotonic clock** (`std::time::Instant` / `CLOCK_MONOTONIC_RAW`) — not
  affected by NTP adjustments or a malicious user changing the system clock.
- **Bounded resources**: the ring buffer drops oldest on overflow, with a
  metric that surfaces the condition to operations.

See `../docs/bpas/SPEC.md` for the full architecture and
`../docs/bpas/THREAT_MODEL.md` for the threat analysis.

## Build

```bash
cd agent-rust
cargo build --release
./target/release/bpas-agent --help   # (once main.rs is extended with clap)
```

The release profile uses `lto = "fat"` and `codegen-units = 1` to minimize
binary size and eliminate reflection-style metadata. Strip removes debug
symbols.

## Configuration

Default path: `/etc/bpas/agent.toml`. Override with `BPAS_CONFIG=...`.

```toml
buffer_capacity = 4096

[tpm]
use_tpm = true
pcr_indices = [0, 2, 7]
# software_key_path = "/var/lib/bpas/dev.key"  # only with use_tpm = false

[transport]
endpoint = "https://inference.internal:8443"
client_cert = "/etc/bpas/client.crt"
client_key = "/etc/bpas/client.key"
server_ca = "/etc/bpas/ca.crt"
flush_interval_ms = 1000
max_batch = 256

[capture]
skip_bare_modifiers = true
capture_mouse_movement = true
capture_window_events = true
```

Any field can be overridden via env var with the `BPAS_` prefix and `__`
separators, e.g. `BPAS_TRANSPORT__ENDPOINT=https://...`.

## Running as a service

On Linux, the agent expects to run as a systemd unit with:

- `CapabilityBoundingSet=CAP_IPC_LOCK` (for `mlockall`)
- `AmbientCapabilities=CAP_IPC_LOCK`
- Input access via a dedicated group (`input` on most distributions)
- `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`
- `NoNewPrivileges=true`
- A `SystemCallFilter=` list derived from the seccomp-bpf profile

Example unit skeleton:

```ini
[Unit]
Description=BPAS Endpoint Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/bpas-agent
Restart=on-failure
RestartSec=5
User=bpas
Group=input
AmbientCapabilities=CAP_IPC_LOCK
CapabilityBoundingSet=CAP_IPC_LOCK
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native
ReadOnlyPaths=/etc/bpas
ReadWritePaths=/var/lib/bpas

[Install]
WantedBy=multi-user.target
```

## Testing

```bash
cargo test                    # unit tests (no hardware required)
cargo test --release          # same, optimized
cargo clippy -- -D warnings   # pedantic lints
cargo fmt --check             # formatting
```

The capture modules include platform-specific code gated by `cfg(target_os)`;
tests exercise the platform-agnostic parts (encoding, crypto, ring buffer)
so `cargo test` works on any supported host.

## Security checklist for review

- [ ] `unsafe_code = "deny"` in `Cargo.toml`
- [ ] All keys wrapped in `Zeroize + ZeroizeOnDrop`
- [ ] HMAC verification uses constant-time comparison (`subtle`)
- [ ] Monotonic clock only
- [ ] No allocation on hot capture path
- [ ] mlock on Linux, documented fallback elsewhere
- [ ] TLS 1.3 only, no renegotiation, AEAD cipher suites
- [ ] Certs loaded once, no runtime reload from untrusted sources
- [ ] Rate-limited reconnect with capped back-off
- [ ] Ring buffer bounds memory; drops are observable
- [ ] No use of `std::env::args` for secrets (only config files + env vars)
