use anyhow::Result;
use std::time::Duration;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    let bind = "127.0.0.1:50053";
    let secret = b"example-secret".to_vec();
    let provider_did = "did:mesh:agent:provider-e2e";

    // Start server in background
    let bind_clone = bind.to_string();
    let secret_clone = secret.clone();
    let provider_clone = provider_did.to_string();
    let server_handle = tokio::spawn(async move {
        if let Err(e) = mesh_dataplane::serve(&bind_clone, secret_clone, provider_clone).await {
            eprintln!("server error: {}", e);
        }
    });

    // Wait for server to start
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Prepare client
    let endpoint = format!("http://{}", bind);
    let session_secret = secret.clone();
    let session_id = Uuid::new_v4().to_string();
    let consumer_did = "did:mesh:agent:consumer-e2e";

    let token = mesh_session::issue_simple_token(&session_secret, &session_id, consumer_did, provider_did);

    println!("Connecting to {}", endpoint);
    let mut client = mesh_dataplane::DataPlaneConsumerClient::connect(&endpoint).await?;

    let payload = serde_json::json!({"description": "E2E test payload"}).to_string().into_bytes();

    let result = client.call(&session_id, &token, consumer_did, &payload).await?;
    println!("E2E Result: {}", String::from_utf8_lossy(&result));

    // Shutdown server
    server_handle.abort();
    Ok(())
}
