package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/mesh-protocol-ai/amp/pkg/agentcard"
)

// registryClient lists agents from the Registry HTTP API (implements RegistryLister).
type registryClient struct {
	baseURL string
	client  *http.Client
}

func newRegistryClient(baseURL string) *registryClient {
	return &registryClient{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		client:  http.DefaultClient,
	}
}

func (c *registryClient) ListCandidates(ctx context.Context, domain []string, capabilityID string) ([]*agentcard.Card, error) {
	url := c.baseURL + "/agents?"
	if len(domain) > 0 {
		url += "domain=" + strings.Join(domain, ",") + "&"
	}
	if capabilityID != "" {
		url += "capability=" + capabilityID
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("registry returned %d", resp.StatusCode)
	}
	var out struct {
		Agents []*agentcard.Card `json:"agents"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Agents, nil
}
