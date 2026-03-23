use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    // Simple provider example: serves on 127.0.0.1:50051
    let bind = "127.0.0.1:50051";
    let secret = b"example-secret".to_vec();
    let provider_did = "did:mesh:agent:provider-example";

    println!("Starting DataPlane server on {}", bind);
    mesh_dataplane::serve(bind, secret, provider_did).await?;
    Ok(())
}
