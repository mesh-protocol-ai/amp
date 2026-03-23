use anyhow::Context;
use futures::future::BoxFuture;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::watch;

#[derive(Clone)]
pub struct RelayOptions {
    pub relay_host: String,
    pub control_port: u16,
    pub data_port: u16,
    pub agent_did: String,
    pub local_grpc_addr: String,
}

pub struct RelayTunnel {
    pub grpc_address: String,
    pub assigned_port: u16,
    stop_tx: watch::Sender<bool>,
    _bg: Arc<tokio::task::JoinHandle<()>>,
}

impl RelayTunnel {
    /// Start a relay tunnel. Returns public grpc address and assigned port.
    pub async fn start(opts: RelayOptions) -> Result<Self, anyhow::Error> {
        let control_addr = format!("{}:{}", opts.relay_host, opts.control_port);
        let mut ctrl = TcpStream::connect(&control_addr).await.with_context(|| format!("connect control to {}", control_addr))?;

        // Send REGISTER {did}\n
        let register_line = format!("REGISTER {}\n", opts.agent_did);
        ctrl.write_all(register_line.as_bytes()).await.context("write REGISTER")?;

        let mut reader = BufReader::new(ctrl);
        let mut line = String::new();
        // Read reply line
        reader.read_line(&mut line).await.context("read register reply")?;
        let line = line.trim_end().to_string();
        // Expect either OK {port} or ERR ...
        if line.starts_with("OK ") {
            let port_str = line[3..].trim();
            let assigned_port: u16 = port_str.parse().context("parse assigned port")?;

            // Send PING keepalive loop and listen for commands in background
            let (stop_tx, mut stop_rx) = watch::channel(false);
            let relay_host = opts.relay_host.clone();
            let data_port = opts.data_port;
            let local_grpc = opts.local_grpc_addr.clone();

            let bg = tokio::spawn(async move {
                // Reconnect control as owned TcpStream for continuous read loop
                if let Ok(mut ctrl_conn) = TcpStream::connect(format!("{}:{}", relay_host, opts.control_port)).await {
                    // Re-register
                    let _ = ctrl_conn.write_all(register_line.as_bytes()).await;
                    let mut buf_reader = BufReader::new(ctrl_conn);
                    let mut cmd = String::new();
                    loop {
                        tokio::select! {
                            res = buf_reader.read_line(&mut cmd) => {
                                match res {
                                    Ok(0) => break, // EOF
                                    Ok(_) => {
                                        let trimmed = cmd.trim_end().to_string();
                                        cmd.clear();
                                        if trimmed.starts_with("CONNECT ") {
                                            // Format: CONNECT {conn_id}\n
                                            let parts: Vec<&str> = trimmed.split_whitespace().collect();
                                            if parts.len() >= 2 {
                                                let conn_id = parts[1].to_string();
                                                // Spawn proxy task: connect to relay data port and to local gRPC and proxy
                                                let relay_host_clone = relay_host.clone();
                                                let local_clone = local_grpc.clone();
                                                tokio::spawn(async move {
                                                    if let Err(e) = handle_proxy(&relay_host_clone, data_port, &local_clone, &conn_id).await {
                                                        eprintln!("proxy {} error: {}", conn_id, e);
                                                    }
                                                });
                                            }
                                        }
                                        // ignore other commands
                                    }
                                    Err(e) => { eprintln!("control read error: {}", e); break; }
                                }
                            }
                            _ = stop_rx.changed() => {
                                if *stop_rx.borrow() { break; }
                            }
                        }
                    }
                }
            });

            let grpc_address = format!("{}:{}", opts.relay_host, assigned_port);
            Ok(Self { grpc_address, assigned_port, stop_tx, _bg: Arc::new(bg) })
        } else {
            Err(anyhow::anyhow!("register failed: {}", line))
        }
    }

    pub async fn close(self) -> Result<(), anyhow::Error> {
        let _ = self.stop_tx.send(true);
        Ok(())
    }
}

async fn handle_proxy(relay_host: &str, data_port: u16, local_grpc: &str, _conn_id: &str) -> Result<(), anyhow::Error> {
    // Connect to relay data port
    let relay_data = format!("{}:{}", relay_host, data_port);
    let mut remote = TcpStream::connect(&relay_data).await.with_context(|| format!("connect to relay data {}", relay_data))?;

    // Connect to local gRPC endpoint
    let mut local = TcpStream::connect(local_grpc).await.with_context(|| format!("connect to local grpc {}", local_grpc))?;

    // Proxy bidirectionally
    let (mut r_read, mut r_write) = remote.split();
    let (mut l_read, mut l_write) = local.split();

    let client_to_local = tokio::io::copy(&mut r_read, &mut l_write);
    let local_to_client = tokio::io::copy(&mut l_read, &mut r_write);

    tokio::try_join!(client_to_local, local_to_client).context("proxy join")?;
    Ok(())
}
