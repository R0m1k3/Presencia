use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    process::ExitCode,
    time::Duration,
};

use presencia::{AppState, app, bootstrap::bootstrap, config::Config, db};

/// `presencia healthcheck`: exit code 0 when `/api/health` answers 200
/// (the runtime image has no shell nor curl).
fn healthcheck(port: u16) -> ExitCode {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let check = || -> std::io::Result<bool> {
        let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(3))?;
        s.set_read_timeout(Some(Duration::from_secs(3)))?;
        s.write_all(b"GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
        let mut head = [0u8; 12];
        s.read_exact(&mut head)?;
        Ok(head.starts_with(b"HTTP/1.1 200"))
    };
    if check().unwrap_or(false) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

async fn shutdown() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let cfg = Config::from_env();
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        return healthcheck(cfg.port);
    }

    let pool = db::pool(&cfg);
    let secret = match bootstrap(&pool, &cfg).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Échec du démarrage : {e}");
            return ExitCode::FAILURE;
        }
    };
    let port = cfg.port;
    let state = AppState::new(pool, cfg, secret);

    // Dual stack, like Node's default listener; IPv4 only when IPv6 is unavailable.
    let listener = match tokio::net::TcpListener::bind(SocketAddr::from(([0u16; 8], port))).await {
        Ok(l) => Ok(l),
        Err(_) => tokio::net::TcpListener::bind(SocketAddr::from(([0u8; 4], port))).await,
    };
    let listener = match listener {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Échec du démarrage : {e}");
            return ExitCode::FAILURE;
        }
    };
    println!("Presencia API démarrée sur le port {port}");
    let server = axum::serve(listener, app(state).into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown());
    if let Err(e) = server.await {
        eprintln!("{e}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
