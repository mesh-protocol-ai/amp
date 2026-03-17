# AMP Enterprise test — AWS (Terraform)

Provisions a single EC2 instance with Docker installed, ready to run the AMP stack (NATS, Registry, Matching, Postgres) and 4 test agents.

## Prerequisites

- AWS CLI configured (`aws configure`)
- Terraform >= 1.0
- An SSH key pair created in AWS (EC2 → Key Pairs) — use its **name** for `ssh_key_name`

## Usage

1. Copy and edit variables (or use tfvars):

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   # Edit: ssh_key_name, region, allowed_ssh_cidrs
   ```

2. Apply:

   ```bash
   terraform init
   terraform plan -out=tfplan
   terraform apply tfplan
   ```

3. Note `public_ip` from the output. In your DNS (e.g. Route53 or your registrar):

   - `api.meshprotocol.dev` → A record → `public_ip`
   - `nats.meshprotocol.dev` → A record → `public_ip`

4. SSH into the VM and deploy the Docker stack:

   ```bash
   ssh -i your-key.pem ubuntu@<public_ip>
   # Clone this repo (or copy deployments/public + root Dockerfiles)
   # Configure .env (POSTGRES_PASSWORD, NATS_TOKEN, etc.)
   # Adapt Caddyfile for meshprotocol.dev
   # docker compose -f deployments/public/docker-compose.yml up -d --build
   ```

See [docs/ENTERPRISE_TEST_SETUP.md](../../../docs/ENTERPRISE_TEST_SETUP.md) for the full MVP design and 4 test agents setup.
