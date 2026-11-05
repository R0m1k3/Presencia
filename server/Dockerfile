# Build stage: dependencies first (cached layer), then the application.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && cargo build --release --locked && rm -rf src
COPY src src
COPY migrations migrations
RUN touch src/main.rs src/lib.rs && cargo build --release --locked

# Runtime: glibc only, no shell, unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/target/release/presencia /app/presencia
ENV PORT=4790
EXPOSE 4790
USER nonroot
ENTRYPOINT ["/app/presencia"]
