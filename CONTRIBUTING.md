# Contributing to AMP

Thank you for contributing.

## Before opening a PR

1. Open an issue describing the problem or proposal (when relevant).
2. Align small scope and objective.
3. Avoid mixing large refactors with feature/bugfix in the same PR.

## Recommended flow

1. Fork + dedicated branch.
2. Run locally:
   - `go test ./pkg/...`
   - `go vet ./...`
3. Update documentation when public behavior changes.
4. Send PR with context of “why” the change.

## PR standards

Include in the PR:
- problem solved;
- approach adopted;
- risks and limitations;
- how to test.

## Project scope

Changes that affect protocol interoperability must prioritize backward compatibility whenever possible.

## Security

Do not open vulnerability reports in public issues. See `SECURITY.md`.
