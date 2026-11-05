# One image: the Rust binary serves the API and the web UI it embeds.

# Web UI (Svelte): web/dist, embedded by the Rust build below.
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM rust:1-bookworm AS build
WORKDIR /src/server
# Dependencies first (cached layer). build.rs needs a web/dist to embed.
COPY server/Cargo.toml server/Cargo.lock server/build.rs ./
RUN mkdir src ../web ../web/dist && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && echo '<!doctype html>' > ../web/dist/index.html \
    && cargo build --release --locked && rm -rf src ../web/dist
COPY server/ ./
COPY --from=web /src/web/dist /src/web/dist
RUN touch src/main.rs src/lib.rs build.rs && cargo build --release --locked

# Runtime: glibc only, no shell, unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/server/target/release/presencia /app/presencia
ENV PORT=80
EXPOSE 80
USER nonroot
ENTRYPOINT ["/app/presencia"]
