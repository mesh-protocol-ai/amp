// Package cloudevents provides CloudEvents envelope with AMP extensions for the control plane.
package cloudevents

import (
	"encoding/json"
	"fmt"
	"time"

	cloudevents "github.com/cloudevents/sdk-go/v2"
	"github.com/cloudevents/sdk-go/v2/event"
	"github.com/google/uuid"
)

const (
	// AMPVersion is the AMP protocol version used in extensions.
	AMPVersion = "0.1.0"
)

// AMP event types (SPECS 7.3).
const (
	TypeAgentRegister    = "amp.agent.register"
	TypeAgentUpdate     = "amp.agent.update"
	TypeAgentHeartbeat  = "amp.agent.heartbeat"
	TypeAgentDeregister = "amp.agent.deregister"

	TypeCapabilityRequest = "amp.capability.request"
	TypeCapabilityBid     = "amp.capability.bid"
	TypeCapabilityMatch   = "amp.capability.match"
	TypeCapabilityReject  = "amp.capability.reject"
	TypeCapabilityCancel  = "amp.capability.cancel"

	TypeTaskAccepted  = "amp.task.accepted"
	TypeTaskProgress  = "amp.task.progress"
	TypeTaskCompleted = "amp.task.completed"
	TypeTaskFailed    = "amp.task.failed"
	TypeTaskTimeout   = "amp.task.timeout"
)

// AMP extension names (SPECS 7.2).
const (
	ExtAMPVersion    = "ampversion"
	ExtCorrelationID = "correlationid"
	ExtSessionID     = "sessionid"
	ExtTraceID       = "traceid"
	ExtSignature     = "signature"
)

// AMPExtensions contains AMP extensions from an event.
type AMPExtensions struct {
	AMPVersion    string `json:"ampversion,omitempty"`
	CorrelationID string `json:"correlationid,omitempty"`
	SessionID     string `json:"sessionid,omitempty"`
	TraceID       string `json:"traceid,omitempty"`
	Signature     string `json:"signature,omitempty"`
}

// NewEvent creates a CloudEvent with type, source, and data, then applies AMP extensions.
func NewEvent(eventType, source string, data interface{}, ext AMPExtensions) (*event.Event, error) {
	e := cloudevents.NewEvent()
	e.SetID(uuid.Must(uuid.NewV7()).String())
	e.SetType(eventType)
	e.SetSource(source)
	e.SetTime(time.Now().UTC())
	e.SetDataContentType(cloudevents.ApplicationJSON)
	if ext.AMPVersion == "" {
		ext.AMPVersion = AMPVersion
	}
	if ext.CorrelationID != "" {
		e.SetExtension(ExtCorrelationID, ext.CorrelationID)
	}
	if ext.SessionID != "" {
		e.SetExtension(ExtSessionID, ext.SessionID)
	}
	if ext.TraceID != "" {
		e.SetExtension(ExtTraceID, ext.TraceID)
	}
	if ext.Signature != "" {
		e.SetExtension(ExtSignature, ext.Signature)
	}
	e.SetExtension(ExtAMPVersion, ext.AMPVersion)
	if data != nil {
		if err := e.SetData(cloudevents.ApplicationJSON, data); err != nil {
			return nil, fmt.Errorf("set data: %w", err)
		}
	}
	return &e, nil
}

// GetAMPExtensions reads AMP extensions from an event.
func GetAMPExtensions(e event.Event) AMPExtensions {
	var ext AMPExtensions
	if v, ok := e.Extensions()[ExtAMPVersion]; ok {
		ext.AMPVersion, _ = v.(string)
	}
	if v, ok := e.Extensions()[ExtCorrelationID]; ok {
		ext.CorrelationID, _ = v.(string)
	}
	if v, ok := e.Extensions()[ExtSessionID]; ok {
		ext.SessionID, _ = v.(string)
	}
	if v, ok := e.Extensions()[ExtTraceID]; ok {
		ext.TraceID, _ = v.(string)
	}
	if v, ok := e.Extensions()[ExtSignature]; ok {
		ext.Signature, _ = v.(string)
	}
	return ext
}

// SerializeJSON serializes the event to JSON (to publish on NATS).
func SerializeJSON(e *event.Event) ([]byte, error) {
	return json.Marshal(e)
}

// ParseJSON deserializes a CloudEvent from JSON.
func ParseJSON(b []byte) (*event.Event, error) {
	var e event.Event
	if err := json.Unmarshal(b, &e); err != nil {
		return nil, fmt.Errorf("unmarshal cloudevent: %w", err)
	}
	return &e, nil
}
