# AMP — Fase 0 + Fase 1 (Registry, Matching)
# Uso: make proto, make test, make up

.PHONY: proto test lint up build-registry build-matching

proto:
	docker run --rm -v "$$(pwd):/workspace" -w /workspace bufbuild/buf:latest generate

test:
	go test ./pkg/...

lint:
	go vet ./...
	golangci-lint run ./pkg/... 2>/dev/null || go vet ./...

# Sobe toda a stack (NATS, Postgres, Registry, Matching).
up:
	docker compose up -d

# Build dos serviços (para desenvolvimento local).
build-registry:
	go build -o bin/registry ./services/registry

build-matching:
	go build -o bin/matching ./services/matching
