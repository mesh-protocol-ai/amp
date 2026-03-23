use anyhow::Result;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    // Consumer example: connects to provider and performs call
    let endpoint = "http://127.0.0.1:50051"; // tonic requires scheme
    let session_secret = b"example-secret".to_vec();
    let session_id = Uuid::new_v4().to_string();
    let consumer_did = "did:mesh:agent:consumer-example";
    let provider_did = "did:mesh:agent:provider-example";

    // Issue simple HMAC token compatible with server secret
    let token = mesh_session::issue_simple_token(&session_secret, &session_id, consumer_did, provider_did);

    println!("Connecting to {}", endpoint);
    let mut client = mesh_dataplane::DataPlaneConsumerClient::connect(endpoint).await?;

    let payload = serde_json::json!({"description": "Hello from consumer"}).to_string().into_bytes();

    let result = client.call(&session_id, &token, consumer_did, &payload).await?;
    println!("Result bytes: {}", String::from_utf8_lossy(&result));
    Ok(())
}
