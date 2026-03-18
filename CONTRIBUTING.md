# Contributing to AMP

Thank you for contributing.

## Before opening a PR

1. Open an issue describing the problem or proposal (when relevant).
2. Align small scope and objective.
3. Avoid mixing large refactors with feature/bugfix in the same PR.

## Recommended flow

1. Fork + dedicated branch.
2. (Optional) Install pre-commit for secret scanning: `pip install pre-commit && pre-commit install` (gitleaks hook in `.pre-commit-config.yaml`).
3. Run locally:
   - `go test ./pkg/... ./services/...`
   - `go vet ./...`
   - In `sdk/ts`: `npm run build && npm test`
4. Update documentation when public behavior changes.
5. Send PR with context of “why” the change.

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
