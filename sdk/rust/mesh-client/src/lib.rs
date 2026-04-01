use anyhow::Context;
use async_nats::Client as NatsClient;
use mesh_types::AgentCard;
use reqwest::Client as HttpClient;
use serde_json::json;
use std::time::Duration;
use uuid::Uuid;
use futures::StreamExt;
use futures::future::BoxFuture;
use tokio::sync::watch;

#[derive(Clone)]
pub struct MeshClientConfig {
    pub nats_url: String,
    pub registry_url: String,
    pub did: String,
    pub region: Option<String>,
}

pub struct RegistryClient {
    base: String,
    http: HttpClient,
}

impl RegistryClient {
    pub fn new(base: impl Into<String>) -> Self {
        Self { base: base.into(), http: HttpClient::new() }
    }

    pub async fn get_agent(&self, did: &str) -> Result<AgentCard, anyhow::Error> {
        let url = format!("{}/agents/{}", self.base.trim_end_matches('/'), did);
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .with_context(|| format!("failed to GET {}", url))?;
        let status = res.status();
        let body = res.text().await?;
        if !status.is_success() {
            return Err(anyhow::anyhow!("registry GET failed: {} {}", status, body));
        }
        let card: AgentCard = serde_json::from_str(&body)?;
        Ok(card)
    }
}

pub struct MeshClient {
    cfg: MeshClientConfig,
    nats: NatsClient,
    registry: RegistryClient,
}

pub struct RequestOptions {
    pub domain: Vec<String>,
    pub capability_id: Option<String>,
    pub description: Option<String>,
    pub timeout_ms: Option<u64>,
}

pub type MatchHandler = Box<dyn Fn(mesh_types::MatchOrReject) -> BoxFuture<'static, ()> + Send + Sync + 'static>;

pub struct ListenSubscription {
    stop_tx: watch::Sender<bool>,
}

impl ListenSubscription {
    pub async fn unsubscribe(self) {
        let _ = self.stop_tx.send(true);
    }
}

pub struct HeartbeatHandle {
    stop_tx: watch::Sender<bool>,
}

impl HeartbeatHandle {
    pub async fn stop(self) {
        let _ = self.stop_tx.send(true);
    }
}

impl MeshClient {
    pub async fn new(cfg: MeshClientConfig) -> Result<Self, anyhow::Error> {
        let nats = async_nats::connect(&cfg.nats_url)
            .await
            .with_context(|| format!("connect to nats at {}", &cfg.nats_url))?;
        let registry = RegistryClient::new(cfg.registry_url.clone());
        Ok(Self { cfg, nats, registry })
    }

    pub async fn register(&self, card: &AgentCard) -> Result<(), anyhow::Error> {
        // Validate AgentCard locally before sending to registry
        mesh_types::validate_agent_card(card).map_err(|e| anyhow::anyhow!("invalid agent card: {}", e))?;

        let url = format!("{}/agents", self.cfg.registry_url.trim_end_matches('/'));
        let res = self
            .registry
            .http
            .post(&url)
            .json(card)
            .send()
            .await
            .context("failed to POST agent card")?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("register failed: {} {}", status, body));
        }
        Ok(())
    }

    /// Publish a capability request on the control plane and await a reply.
    /// Returns the raw JSON reply as serde_json::Value for now.
    pub async fn request(&self, opts: RequestOptions) -> Result<mesh_types::MatchOrReject, anyhow::Error> {
        if opts.capability_id.is_none() && opts.description.is_none() {
            return Err(anyhow::anyhow!("either capability_id or description is required"));
        }

        let region = self.cfg.region.clone().unwrap_or_else(|| "global".into());
        let subject = format!("mesh.requests.{}.{}", opts.domain.join("."), region);

        let event_id = Uuid::new_v4().to_string();
        let mut task_data = json!({
            "domain": opts.domain,
        });
        if let Some(ref cap_id) = opts.capability_id {
            task_data["capability_id"] = json!(cap_id);
        }
        if let Some(ref desc) = opts.description {
            task_data["description"] = json!(desc);
        }
        let cloud_event = json!({
            "specversion": "1.0",
            "type": "amp.capability.request",
            "source": self.cfg.did,
            "id": event_id,
            "time": chrono::Utc::now().to_rfc3339(),
            "data": { "task": task_data }
        });

        let payload = serde_json::to_vec(&cloud_event)?;

        let timeout = Duration::from_millis(opts.timeout_ms.unwrap_or(30_000));

        let req_fut = self.nats.request(subject, payload.into());
        let msg = tokio::time::timeout(timeout, req_fut)
            .await
            .map_err(|_| anyhow::anyhow!("request timeout"))??;

        let reply = String::from_utf8_lossy(&msg.payload).to_string();
        let json: serde_json::Value = serde_json::from_str(&reply).context("parse reply JSON")?;
        let parsed = mesh_types::parse_match_or_reject(&json).map_err(|e| anyhow::anyhow!("parse reply: {}", e))?;
        Ok(parsed)
    }

    fn sanitize_did(did: &str) -> String {
        did.replace(':', "_")
    }

    /// Listen for matches directed to this agent DID.
    /// Handler will be invoked for each incoming match/reject.
    pub async fn listen(&self, handler: MatchHandler) -> Result<ListenSubscription, anyhow::Error> {
        let subj = format!("mesh.matches.{}", Self::sanitize_did(&self.cfg.did));
        let mut sub = self.nats.subscribe(subj).await.context("subscribe failed")?;

        let (stop_tx, mut stop_rx) = watch::channel(false);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    maybe = sub.next() => {
                        match maybe {
                            Some(msg) => {
                                let payload = String::from_utf8_lossy(&msg.payload).to_string();
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&payload) {
                                    if let Ok(parsed) = mesh_types::parse_match_or_reject(&json) {
                                        (handler)(parsed).await;
                                    }
                                }
                            }
                            None => break,
                        }
                    }
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() { break; }
                    }
                }
            }
        });

        Ok(ListenSubscription { stop_tx })
    }

    /// Start periodic heartbeats to the control plane.
    pub async fn start_heartbeat(&self, interval_ms: u64) -> Result<HeartbeatHandle, anyhow::Error> {
        let subj = format!("mesh.agents.heartbeat.{}", Self::sanitize_did(&self.cfg.did));
        let (stop_tx, mut stop_rx) = watch::channel(false);
        let nats = self.nats.clone();
        let did = self.cfg.did.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(interval_ms));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let payload = json!({ "did": did, "time": chrono::Utc::now().to_rfc3339() });
                        let _ = nats.publish(subj.clone(), serde_json::to_vec(&payload).unwrap().into()).await;
                    }
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() { break; }
                    }
                }
            }
        });

        Ok(HeartbeatHandle { stop_tx })
    }

    pub async fn close(self) -> Result<(), anyhow::Error> {
        // NATS client flushes on drop
        Ok(())
    }
}

