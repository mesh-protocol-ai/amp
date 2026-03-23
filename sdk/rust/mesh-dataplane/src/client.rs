use anyhow::Context;
use mesh_proto::data_plane_client::DataPlaneClient as TonicDataPlaneClient;
use mesh_proto::{EncryptedChunk, HandshakeRequest, ResultRequest};
use tonic::transport::Channel;
use tonic::Request;
use async_stream::stream;

pub struct DataPlaneConsumerClient {
    inner: TonicDataPlaneClient<Channel>,
}

impl DataPlaneConsumerClient {
    pub async fn connect(endpoint: &str) -> Result<Self, anyhow::Error> {
        let inner = TonicDataPlaneClient::connect(endpoint.to_string()).await.context("connect grpc")?;
        Ok(Self { inner })
    }

    /// Performs handshake, transfer and result sequence. Returns result bytes.
    pub async fn call(&mut self, session_id: &str, session_token: &str, consumer_did: &str, payload: &[u8]) -> Result<Vec<u8>, anyhow::Error> {
        // Handshake
        let hs = HandshakeRequest {
            session_id: session_id.to_string(),
            session_token: session_token.to_string(),
            consumer_ephemeral_pub: Vec::new(),
            consumer_did: consumer_did.to_string(),
            consumer_did_signature: Vec::new(),
        };
        let _ = self.inner.handshake(Request::new(hs)).await.context("handshake failed")?;

        // make owned copies so the stream is 'static
        let sid = session_id.to_string();
        let payload_buf = payload.to_vec();

        // Transfer: stream one chunk with sequence 1 and cipher = payload
        let outbound = stream! {
            // first chunk include session_id as sequence 0 metadata
            let meta = serde_json::json!({"session_id": sid});
            let meta_chunk = EncryptedChunk { ciphertext: meta.to_string().into_bytes(), nonce: Vec::new(), sequence: 0, is_final: false, algorithm: "none".to_string() };
            yield meta_chunk;
            let chunk = EncryptedChunk { ciphertext: payload_buf.clone(), nonce: Vec::new(), sequence: 1, is_final: true, algorithm: "none".to_string() };
            yield chunk;
        };

        let _ack = self.inner.transfer(Request::new(outbound)).await.context("transfer failed")?;

        // Result: streaming response
        let mut stream = self.inner.result(Request::new(ResultRequest { session_id: session_id.to_string() })).await?.into_inner();
        let mut result = Vec::new();
        while let Some(chunk) = stream.message().await.context("result stream error")? {
            result.extend_from_slice(&chunk.ciphertext);
            if chunk.is_final { break; }
        }
        Ok(result)
    }
}
