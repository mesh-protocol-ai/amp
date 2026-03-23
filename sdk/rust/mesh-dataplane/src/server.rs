use anyhow::Context;
use bytes::Bytes;
use dashmap::DashMap;
use futures::Stream;
use subtle::ConstantTimeEq;
use mesh_proto::data_plane_server::DataPlane;
use mesh_proto::data_plane_server::DataPlaneServer as TonicDataPlaneServer;
use mesh_proto::{EncryptedChunk, HandshakeRequest, HandshakeResponse, TransferAck, ResultRequest};
use std::pin::Pin;
use std::sync::Arc;
use tonic::{Request, Response, Status, Streaming};

#[derive(Clone, Debug)]
#[allow(dead_code)] // fields reserved for future session lifecycle / audit
struct SessionEntry {
    session_token: String,
    consumer_did: String,
    payload: Option<Bytes>,
}

#[derive(Clone)]
pub struct DataPlaneServerImpl {
    sessions: Arc<DashMap<String, SessionEntry>>,
    session_secret: Vec<u8>,
    provider_did: String,
}

impl DataPlaneServerImpl {
    pub fn new(session_secret: Vec<u8>, provider_did: impl Into<String>) -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            session_secret,
            provider_did: provider_did.into(),
        }
    }
}

#[tonic::async_trait]
impl DataPlane for DataPlaneServerImpl {
    async fn handshake(&self, req: Request<HandshakeRequest>) -> Result<Response<HandshakeResponse>, Status> {
        let r = req.into_inner();
        let session_id = r.session_id.clone();
        let token = r.session_token.clone();
        let consumer = r.consumer_did.clone();

        // Validate token using mesh-session HMAC validator
        let expected = mesh_session::issue_simple_token(&self.session_secret, &session_id, &consumer, &self.provider_did);
        let ok: bool = expected.as_bytes().ct_eq(token.as_bytes()).into();
        if !ok {
            eprintln!("token mismatch: expected={} provided={}", expected, token);
        }
        if !ok {
            return Err(Status::unauthenticated("invalid session token"));
        }

        // store session
        self.sessions.insert(session_id.clone(), SessionEntry { session_token: token.clone(), consumer_did: consumer.clone(), payload: None });

        let resp = HandshakeResponse {
            provider_ephemeral_pub: Vec::new(),
            provider_did: self.provider_did.clone(),
            provider_did_signature: Vec::new(),
            attestation: None,
        };
        Ok(Response::new(resp))
    }

    async fn transfer(&self, req: Request<Streaming<EncryptedChunk>>) -> Result<Response<TransferAck>, Status> {
        let mut stream = req.into_inner();
        // For this simple implementation, the client should have sent a first chunk containing session_id in metadata; we accept chunks and reconstruct a payload keyed by session id inside ciphertext's first bytes encoded as UTF-8 prefix JSON.
        // Simpler: expect first chunk sequence==0 with plaintext JSON {"session_id":"..."} as ciphertext.

        let mut session_id_opt: Option<String> = None;
        let mut buffer = Vec::new();
        let mut chunks = 0u32;

        while let Some(item) = stream.message().await.map_err(|e| Status::internal(format!("stream error: {}", e)))? {
            chunks += 1;
            if session_id_opt.is_none() && item.sequence == 0 {
                // try to parse the ciphertext as UTF-8 JSON
                if let Ok(s) = String::from_utf8(item.ciphertext.clone()) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                        if let Some(sid) = v.get("session_id").and_then(|x| x.as_str()) {
                            session_id_opt = Some(sid.to_string());
                            continue;
                        }
                    }
                }
            }
            // append ciphertext as payload
            buffer.extend_from_slice(&item.ciphertext);
        }

        let session_id = session_id_opt.ok_or_else(|| Status::invalid_argument("missing session_id in first chunk"))?;
        let payload = Bytes::from(buffer);

        if let Some(mut entry) = self.sessions.get_mut(&session_id) {
            entry.payload = Some(payload.clone());
        } else {
            // create session entry if missing
            self.sessions.insert(session_id.clone(), SessionEntry { session_token: String::new(), consumer_did: String::new(), payload: Some(payload.clone()) });
        }

        let ack = TransferAck { accepted: true, chunks_received: chunks, error_code: None, error_message: None };
        Ok(Response::new(ack))
    }

    type ResultStream = Pin<Box<dyn Stream<Item = Result<EncryptedChunk, Status>> + Send + 'static>>;

    async fn result(&self, req: Request<ResultRequest>) -> Result<Response<Self::ResultStream>, Status> {
        let session_id = req.into_inner().session_id;
        let sessions = self.sessions.clone();

        let out = async_stream::try_stream! {
            if let Some(entry) = sessions.get(&session_id) {
                if let Some(payload) = entry.payload.clone() {
                    let chunk = EncryptedChunk {
                        ciphertext: payload.to_vec(),
                        nonce: Vec::new(),
                        sequence: 1,
                        is_final: true,
                        algorithm: "none".to_string(),
                    };
                    yield chunk;
                } else {
                    Err(Status::not_found("no payload for session"))?;
                }
            } else {
                Err(Status::not_found("session not found"))?;
            }
        };

        Ok(Response::new(Box::pin(out) as Self::ResultStream))
    }

    // StreamingTask not implemented in this MVP
    type StreamingTaskStream = Pin<Box<dyn Stream<Item = Result<EncryptedChunk, Status>> + Send + 'static>>;
    async fn streaming_task(&self, _req: Request<Streaming<EncryptedChunk>>) -> Result<Response<Self::StreamingTaskStream>, Status> {
        Err(Status::unimplemented("StreamingTask not implemented"))
    }
}

pub async fn serve(bind_addr: &str, session_secret: Vec<u8>, provider_did: impl Into<String>) -> Result<(), anyhow::Error> {
    let svc = DataPlaneServerImpl::new(session_secret, provider_did);
    let addr = bind_addr.parse().context("parse bind_addr")?;
    tonic::transport::Server::builder()
        .add_service(TonicDataPlaneServer::new(svc))
        .serve(addr)
        .await
        .context("server failed")?;
    Ok(())
}
