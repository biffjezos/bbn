# ── Build stage ───────────────────────────────────────────────
FROM rust:nightly AS builder
WORKDIR /build
# Copy entire workspace (Cargo.toml, common/, tiers-service/)
COPY . .
RUN cargo build --release -p tiers-service

# ── Runtime stage ─────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libssl3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/tiers-service /usr/local/bin/tiers-service
EXPOSE 8080
CMD ["/usr/local/bin/tiers-service"]
