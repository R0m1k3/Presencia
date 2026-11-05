# One image: the Rust binary serves the API and the web UI it embeds.
# PR 2a: the UI is still the static frontend/public; the Svelte build replaces
# this copy in PR 2b.

FROM rust:1-bookworm AS build
WORKDIR /src/server
# Dependencies first (cached layer). build.rs needs a web/dist to embed.
COPY server/Cargo.toml server/Cargo.lock server/build.rs ./
RUN mkdir src ../web ../web/dist && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && echo '<!doctype html>' > ../web/dist/index.html \
    && cargo build --release --locked && rm -rf src ../web/dist
COPY server/ ./
COPY frontend/public /src/web/dist
RUN touch src/main.rs src/lib.rs build.rs && cargo build --release --locked

# Runtime: glibc only, no shell, unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/server/target/release/presencia /app/presencia
ENV PORT=80
EXPOSE 80
USER nonroot
ENTRYPOINT ["/app/presencia"]
