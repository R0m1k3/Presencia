//! `../web/dist` is embedded by rust-embed and must exist at compile time.
//! Debug builds (tests, clippy) get a placeholder page so that they run
//! without Node; a release build refuses to embed a missing UI or the
//! placeholder, so that no image can ship a blank page.

use std::{fs, path::Path};

const PLACEHOLDER_MARK: &str = "<!-- presencia: interface non construite -->";

fn main() {
    let dist = Path::new("../web/dist");
    let index = dist.join("index.html");
    println!("cargo:rerun-if-changed=../web/dist");
    println!("cargo:rerun-if-changed=build.rs");

    let current = fs::read_to_string(&index).ok();
    let missing = current.as_deref().is_none_or(|s| s.contains(PLACEHOLDER_MARK));
    if !missing {
        return;
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("web/dist/index.html manquant : construisez l'interface avant `cargo build --release`.");
    }
    if current.is_none() {
        fs::create_dir_all(dist).expect("création de web/dist");
        fs::write(
            &index,
            format!(
                "<!doctype html>{PLACEHOLDER_MARK}<html lang=\"fr\"><meta charset=\"utf-8\">\
                 <title>Presencia</title><p>Interface non construite.</p></html>\n"
            ),
        )
        .expect("écriture de web/dist/index.html");
    }
}
