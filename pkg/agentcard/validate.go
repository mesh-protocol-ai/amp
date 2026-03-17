package agentcard

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	didAgentRe = regexp.MustCompile(`^did:mesh:agent:[a-zA-Z0-9_-]+$`)
	didOrgRe   = regexp.MustCompile(`^did:mesh:org:[a-zA-Z0-9_-]+$`)
	versionRe  = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
)

// Validate checks required fields and formats of Agent Card (MVP).
func Validate(c *Card) error {
	if c == nil {
		return fmt.Errorf("card is nil")
	}
	if !didAgentRe.MatchString(c.Metadata.ID) {
		return fmt.Errorf("metadata.id must match did:mesh:agent:<id>")
	}
	if c.Metadata.Name == "" {
		return fmt.Errorf("metadata.name is required")
	}
	if !versionRe.MatchString(c.Metadata.Version) {
		return fmt.Errorf("metadata.version must be semver (e.g. 1.0.0)")
	}
	if !didOrgRe.MatchString(c.Metadata.Owner) {
		return fmt.Errorf("metadata.owner must match did:mesh:org:<id>")
	}
	if len(c.Spec.Domains.Primary) == 0 {
		return fmt.Errorf("spec.domains.primary is required and non-empty")
	}
	if len(c.Spec.Capabilities) == 0 {
		return fmt.Errorf("spec.capabilities is required and non-empty")
	}
	for i, cap := range c.Spec.Capabilities {
		if cap.ID == "" {
			return fmt.Errorf("spec.capabilities[%d].id is required", i)
		}
	}
	if c.Spec.Endpoints.ControlPlane.NATSSubject == "" {
		return fmt.Errorf("spec.endpoints.control_plane.nats_subject is required")
	}
	if strings.TrimSpace(c.Spec.Endpoints.DataPlane.GRPC) == "" {
		return fmt.Errorf("spec.endpoints.data_plane.grpc is required")
	}
	return nil
}
