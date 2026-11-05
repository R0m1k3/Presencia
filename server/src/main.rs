use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    process::ExitCode,
    time::Duration,
};

use axum::{Router, extract::ConnectInfo};
use hyper_util::{
    rt::{TokioIo, TokioTimer},
    server::graceful::GracefulShutdown,
};
use presencia::{AppState, app, bootstrap::bootstrap, config::Config, db};
use tokio::net::TcpListener;
use tower::ServiceExt;

/// Node's `server.headersTimeout`: a client that sends its headers slower
/// than this (slowloris) is disconnected.
const HEADERS_TIMEOUT: Duration = Duration::from_secs(60);

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

    // Dual stack, like Node's default listener; IPv4 only when IPv6 is
    // unavailable (a port already in use fails the same on both).
    let listener = match TcpListener::bind(SocketAddr::from(([0u16; 8], port))).await {
        Ok(l) => Ok(l),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => Err(e),
        Err(e) => {
            eprintln!("IPv6 indisponible ({e}), écoute en IPv4 seulement");
            TcpListener::bind(SocketAddr::from(([0u8; 4], port))).await
        }
    };
    let listener = match listener {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Échec du démarrage : {e}");
            return ExitCode::FAILURE;
        }
    };
    println!("Presencia API démarrée sur le port {port}");
    serve(listener, app(state)).await;
    ExitCode::SUCCESS
}

/// HTTP/1.1 only, like the Node server behind nginx. Stops accepting on
/// SIGTERM / Ctrl-C, then waits for the open connections to finish.
async fn serve(listener: TcpListener, app: Router) {
    let mut http = hyper::server::conn::http1::Builder::new();
    http.timer(TokioTimer::new()).header_read_timeout(HEADERS_TIMEOUT);
    let graceful = GracefulShutdown::new();
    let stop = shutdown();
    tokio::pin!(stop);
    loop {
        let (stream, peer) = tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok(a) => a,
                Err(e) => {
                    // Usually EMFILE: wait instead of spinning.
                    eprintln!("accept: {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            },
            _ = &mut stop => break,
        };
        let app = app.clone();
        let svc = hyper::service::service_fn(move |mut req: hyper::Request<hyper::body::Incoming>| {
            req.extensions_mut().insert(ConnectInfo(peer));
            app.clone().oneshot(req)
        });
        let conn = graceful.watch(http.serve_connection(TokioIo::new(stream), svc));
        tokio::spawn(async move {
            // Client resets and header timeouts are routine, not worth a log line.
            let _ = conn.await;
        });
    }
    drop(listener);
    graceful.shutdown().await;
}
