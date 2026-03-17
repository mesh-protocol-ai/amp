# AMP public deployment (meshprotocol.dev)

One VM runs: NATS, Registry, Matching, Postgres, Caddy (TLS).

## On the server (after clone)

1. **Create `.env` from the example**
   ```bash
   cd deployments/public
   cp .env.example .env
   nano .env   # set POSTGRES_PASSWORD and NATS_TOKEN to strong values
   ```

2. **Optional: change domain in Caddyfile**  
   If you use a different domain than `api.meshprotocol.dev`, edit `Caddyfile` and replace the hostname.

3. **Build and start**
   ```bash
   docker compose up -d --build
   ```

4. **Check**
   - Registry: `https://api.meshprotocol.dev` (after DNS points to this host)
   - NATS: `nats://<NATS_TOKEN>@nats.meshprotocol.dev:4222` (use the token from `.env` in your SDK)

5. **Test subdomains and services**
   ```bash
   chmod +x test-services.sh
   ./test-services.sh
   # Or with another domain: ./test-services.sh mydomain.com
   ```
   The script checks: `api.<domain>/health`, `registry.<domain>/health`, NATS TCP on `nats.<domain>:4222`, and `GET /agents`.

## SDK usage

```bash
export NATS_URL="nats://SEU_NATS_TOKEN@nats.meshprotocol.dev:4222"
export REGISTRY_URL="https://api.meshprotocol.dev"
```

Then use `@meshprotocol/sdk` as in the repo docs.
