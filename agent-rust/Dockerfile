# syntax=docker/dockerfile:1.6
#
# BPAS endpoint agent — multi-stage build.
#
# Stage 1 builds a statically-linked musl binary so the runtime image can be
# a minimal distroless base with no libc dependency.
#
# Stage 2 is a slim Debian image that carries CAP_IPC_LOCK and evdev access
# by default; for container deployments without /dev/input the capture
# threads degrade to stubs.

# Rust 1.85 ships edition 2024 stable, which several transitive crates
# (indexmap, hashbrown, etc.) now require. Pin a recent enough toolchain
# rather than the original MSRV so cargo can resolve dependencies.
FROM rust:1.85-bookworm AS builder

# Toolchain for musl static build.
RUN apt-get update && apt-get install -y --no-install-recommends \
        musl-tools pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN rustup target add x86_64-unknown-linux-musl

WORKDIR /build

# Cache dependencies first.
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs
RUN cargo build --release --target x86_64-unknown-linux-musl || true
RUN rm -rf src target/*/release/deps/bpas_agent-*

# Real sources.
COPY src/ ./src/
RUN cargo build --release --target x86_64-unknown-linux-musl

RUN strip target/x86_64-unknown-linux-musl/release/bpas-agent


# ---------------------------------------------------------------------- #

FROM gcr.io/distroless/static-debian12:nonroot AS runtime

LABEL org.opencontainers.image.title="BPAS Agent"
LABEL org.opencontainers.image.description="Behaviour Pattern Authentication System endpoint agent"
LABEL org.opencontainers.image.source="https://github.com/paulrod0/deep-check"
LABEL org.opencontainers.image.licenses="Proprietary"

COPY --from=builder /build/target/x86_64-unknown-linux-musl/release/bpas-agent /usr/local/bin/bpas-agent

USER nonroot:nonroot
ENV BPAS_CONFIG=/etc/bpas/agent.toml
ENTRYPOINT ["/usr/local/bin/bpas-agent"]
