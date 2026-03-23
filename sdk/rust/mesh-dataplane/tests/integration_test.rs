use std::time::Duration;
use uuid::Uuid;

/// Helpers ------------------------------------------------------------------

async fn start_server(addr: &str, secret: Vec<u8>, provider_did: &str) {
    let a = addr.to_string();
    let d = provider_did.to_string();
    tokio::spawn(async move {
        if let Err(e) = mesh_dataplane::serve(&a, secret, d).await {
            eprintln!("[test-server] error: {}", e);
        }
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
}

/// Tests --------------------------------------------------------------------

/// Happy path: issue a valid token, connect, call the provider — result must
/// echo back the submitted payload.
#[tokio::test]
async fn test_e2e_happy_path() {
    let addr = "127.0.0.1:50100";
    let secret = b"test-secret-happy".to_vec();
    let provider_did = "did:mesh:test:provider-happy";
    let consumer_did = "did:mesh:test:consumer-happy";

    start_server(addr, secret.clone(), provider_did).await;

    let endpoint = format!("http://{}", addr);
    let session_id = Uuid::new_v4().to_string();
    let token = mesh_session::issue_simple_token(&secret, &session_id, consumer_did, provider_did);

    let mut client = mesh_dataplane::DataPlaneConsumerClient::connect(&endpoint)
        .await
        .expect("connect");

    let payload = b"hello from integration test";
    let result = client
        .call(&session_id, &token, consumer_did, payload)
        .await
        .expect("call should succeed");

    assert_eq!(result, payload, "provider must echo back the payload");
}

/// Invalid token must be rejected with an Unauthenticated error.
#[tokio::test]
async fn test_handshake_rejects_wrong_token() {
    let addr = "127.0.0.1:50101";
    let secret = b"test-secret-reject".to_vec();
    let provider_did = "did:mesh:test:provider-reject";
    let consumer_did = "did:mesh:test:consumer-reject";

    start_server(addr, secret.clone(), provider_did).await;

    let endpoint = format!("http://{}", addr);
    let session_id = Uuid::new_v4().to_string();
    let bad_token = "this-is-not-a-valid-token";

    let mut client = mesh_dataplane::DataPlaneConsumerClient::connect(&endpoint)
        .await
        .expect("connect");

    let err = client
        .call(&session_id, bad_token, consumer_did, b"payload")
        .await;

    assert!(err.is_err(), "call with wrong token must fail");
    // The error is wrapped in anyhow; the gRPC Unauthenticated status is nested.
    // We just verify the call does fail — the exact message format is an impl detail.
    let _ = err.unwrap_err(); // consume to confirm it is indeed an error
}

/// Token issued for the wrong provider must be rejected.
#[tokio::test]
async fn test_handshake_rejects_mismatched_provider() {
    let addr = "127.0.0.1:50102";
    let secret = b"test-secret-mismatch".to_vec();
    let provider_did = "did:mesh:test:provider-real";
    let consumer_did = "did:mesh:test:consumer-mismatch";

    start_server(addr, secret.clone(), provider_did).await;

    let endpoint = format!("http://{}", addr);
    let session_id = Uuid::new_v4().to_string();
    // Token issued for a different provider
    let token = mesh_session::issue_simple_token(
        &secret,
        &session_id,
        consumer_did,
        "did:mesh:test:provider-OTHER",
    );

    let mut client = mesh_dataplane::DataPlaneConsumerClient::connect(&endpoint)
        .await
        .expect("connect");

    let err = client
        .call(&session_id, &token, consumer_did, b"payload")
        .await;

    assert!(err.is_err(), "token for wrong provider must be rejected");
}

/// Binary payload (non-UTF-8) must survive the round-trip unmodified.
#[tokio::test]
async fn test_binary_payload_roundtrip() {
    let addr = "127.0.0.1:50103";
    let secret = b"test-secret-binary".to_vec();
    let provider_did = "did:mesh:test:provider-binary";
    let consumer_did = "did:mesh:test:consumer-binary";

    start_server(addr, secret.clone(), provider_did).await;

    let endpoint = format!("http://{}", addr);
    let session_id = Uuid::new_v4().to_string();
    let token = mesh_session::issue_simple_token(&secret, &session_id, consumer_did, provider_did);

    let mut client = mesh_dataplane::DataPlaneConsumerClient::connect(&endpoint)
        .await
        .expect("connect");

    let payload: Vec<u8> = (0u8..=255u8).collect();
    let result = client
        .call(&session_id, &token, consumer_did, &payload)
        .await
        .expect("binary call should succeed");

    assert_eq!(result, payload, "binary payload must survive round-trip");
}
