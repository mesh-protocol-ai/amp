use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCard {
    pub metadata: AgentCardMetadata,
    pub spec: AgentCardSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AgentStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCardMetadata {
    pub id: String,
    pub name: String,
    pub version: String,
    pub owner: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCardSpec {
    pub domains: Vec<String>,
    pub capabilities: Vec<CapabilitySpec>,
    pub endpoints: AgentEndpoints,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilitySpec {
    pub id: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEndpoints {
    pub control_plane: ControlPlaneEndpoint,
    pub data_plane: DataPlaneEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlPlaneEndpoint {
    pub nats_subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataPlaneEndpoint {
    pub grpc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatus {
    pub health: Option<String>,
    pub last_heartbeat: Option<String>,
}

pub fn validate_agent_card(card: &AgentCard) -> Result<(), String> {
    if card.metadata.id.is_empty() {
        return Err("metadata.id is empty".into());
    }
    if card.spec.domains.is_empty() {
        return Err("spec.domains is empty".into());
    }
    if card.spec.capabilities.is_empty() {
        return Err("spec.capabilities is empty".into());
    }
    Ok(())
}

use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PartiesData {
    pub consumer: String,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionData {
    pub session_id: String,
    pub created_at: Option<String>,
    pub expires_at: Option<String>,
    pub session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgreedTerms {
    pub max_latency_ms: Option<u64>,
    pub security_level: Option<String>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapabilityMatchData {
    pub request_id: String,
    pub parties: PartiesData,
    pub session: SessionData,
    pub agreed_terms: Option<AgreedTerms>,
    /// 0.0-1.0; set when semantic matching was used
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_score: Option<f64>,
    /// Capability ID that best matched the request description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_capability_id: Option<String>,
    #[serde(flatten)]
    pub extra: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapabilityRejectData {
    pub request_id: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MatchOrReject {
    Match { data: CapabilityMatchData },
    Reject { data: CapabilityRejectData },
}

pub fn parse_match_or_reject(v: &Value) -> Result<MatchOrReject, String> {
    // Try common shapes: either { "kind": "match", "data": { ... } } or CloudEvent-wrapped
    if let Some(kind) = v.get("kind").and_then(|k| k.as_str()) {
        match kind {
            "match" => {
                let data = v.get("data").ok_or("missing data")?;
                let m: CapabilityMatchData = serde_json::from_value(data.clone()).map_err(|e| e.to_string())?;
                return Ok(MatchOrReject::Match { data: m });
            }
            "reject" => {
                let data = v.get("data").ok_or("missing data")?;
                let r: CapabilityRejectData = serde_json::from_value(data.clone()).map_err(|e| e.to_string())?;
                return Ok(MatchOrReject::Reject { data: r });
            }
            _ => return Err("unknown kind".into()),
        }
    }

    // If it's a CloudEvent envelope, inspect type
    if let Some(ty) = v.get("type").and_then(|t| t.as_str()) {
        match ty {
            "amp.capability.match" => {
                let data = v.get("data").ok_or("missing data")?;
                let m: CapabilityMatchData = serde_json::from_value(data.clone()).map_err(|e| e.to_string())?;
                return Ok(MatchOrReject::Match { data: m });
            }
            "amp.capability.reject" => {
                let data = v.get("data").ok_or("missing data")?;
                let r: CapabilityRejectData = serde_json::from_value(data.clone()).map_err(|e| e.to_string())?;
                return Ok(MatchOrReject::Reject { data: r });
            }
            _ => return Err("unknown cloud event type".into()),
        }
    }

    Err("unrecognized message format".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_match_cloud_event() {
        let msg = json!({
            "specversion": "1.0",
            "type": "amp.capability.match",
            "source": "did:mesh:agent:matcher",
            "id": "evt-1",
            "data": {
                "request_id": "req-1",
                "parties": { "consumer": "did:mesh:agent:cons", "provider": "did:mesh:agent:prov" },
                "session": { "session_id": "s-1", "session_token": "tok" }
            }
        });

        let parsed = parse_match_or_reject(&msg).expect("should parse");
        match parsed {
            MatchOrReject::Match { data } => {
                assert_eq!(data.request_id, "req-1");
                assert_eq!(data.parties.consumer, "did:mesh:agent:cons");
            }
            _ => panic!("expected match"),
        }
    }

    #[test]
    fn parse_reject_cloud_event() {
        let msg = json!({
            "specversion": "1.0",
            "type": "amp.capability.reject",
            "source": "did:mesh:agent:matcher",
            "id": "evt-2",
            "data": { "request_id": "req-2", "reason": "no-candidates" }
        });

        let parsed = parse_match_or_reject(&msg).expect("should parse");
        match parsed {
            MatchOrReject::Reject { data } => {
                assert_eq!(data.request_id, "req-2");
                assert_eq!(data.reason.unwrap(), "no-candidates");
            }
            _ => panic!("expected reject"),
        }
    }
}
