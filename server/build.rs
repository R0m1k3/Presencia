//! A release build embeds ../web/dist (rust-embed) and must never ship
//! without the UI. Debug builds (tests, clippy) do not need it: web.rs serves
//! a placeholder page when index.html is missing.

fn main() {
    println!("cargo:rerun-if-changed=../web/dist/index.html");
    if std::env::var("PROFILE").as_deref() == Ok("release") && !std::path::Path::new("../web/dist/index.html").exists()
    {
        panic!("web/dist/index.html manquant : construisez l'interface avant `cargo build --release`.");
    }
}
