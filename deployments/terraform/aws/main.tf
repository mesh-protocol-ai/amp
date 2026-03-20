# AMP Enterprise test — single VM (NATS + Registry + Matching + Postgres + Relay)
# After apply: point api.<domain> and nats.<domain> to the instance public IP, then deploy Docker stack.

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# Latest Ubuntu 22.04 LTS
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Security group: SSH, HTTP, HTTPS, NATS, Data Plane Relay
resource "aws_security_group" "amp" {
  name        = "amp-enterprise-test"
  description = "AMP: SSH, HTTP, HTTPS, NATS 4222, Data Plane Relay"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allowed_ssh_cidrs
    description = "SSH"
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP (Caddy Lets Encrypt)"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS (Registry API)"
  }

  ingress {
    from_port   = 4222
    to_port     = 4222
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "NATS client connections"
  }

  # ── Data Plane Relay ───────────────────────────────────────────────────────
  # Providers connect outbound to 7000 (control) and 7001 (data).
  # Restrict relay_provider_cidrs in production if providers are in known CIDRs.

  ingress {
    from_port   = 7000
    to_port     = 7000
    protocol    = "tcp"
    cidr_blocks = var.relay_provider_cidrs
    description = "Relay: provider control channel"
  }

  ingress {
    from_port   = 7001
    to_port     = 7001
    protocol    = "tcp"
    cidr_blocks = var.relay_provider_cidrs
    description = "Relay: provider data channels"
  }

  ingress {
    from_port   = var.relay_consumer_port_start
    to_port     = var.relay_consumer_port_start + var.relay_consumer_port_size - 1
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Relay: consumer gRPC (one port per provider DID)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Outbound"
  }

  tags = var.tags
}

# EC2 instance
resource "aws_instance" "amp" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = var.ssh_key_name
  vpc_security_group_ids = [aws_security_group.amp.id]

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = <<-EOT
    #!/bin/bash
    set -e
    apt-get update
    apt-get install -y ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    ARCH=$$(dpkg --print-architecture)
    echo "deb [arch=$${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu jammy stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    echo "Docker and Docker Compose plugin installed. Clone repo and run docker compose from deployments/public (adapt for meshprotocol.dev)."
  EOT

  tags = merge(var.tags, {
    Name = "amp-enterprise-test-${var.domain}"
  })
}

# Elastic IP so the public IP does not change on restart
resource "aws_eip" "amp" {
  instance = aws_instance.amp.id
  domain   = "vpc"
  tags     = var.tags
}
