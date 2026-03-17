# AMP Enterprise test — AWS variables

variable "region" {
  description = "AWS region (e.g. us-east-1, sa-east-1)"
  type        = string
  default     = "sa-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for NATS + Registry + Matching + Postgres"
  type        = string
  default     = "t3.small"
}

variable "ssh_key_name" {
  description = "Name of the SSH key pair in AWS for EC2 access"
  type        = string
}

variable "domain" {
  description = "Root domain (e.g. meshprotocol.dev); used for naming only; DNS is managed elsewhere"
  type        = string
  default     = "meshprotocol.dev"
}

variable "allowed_ssh_cidrs" {
  description = "CIDR blocks allowed to SSH (e.g. [\"1.2.3.4/32\"])"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Restrict in production
}

variable "tags" {
  description = "Tags applied to resources"
  type        = map(string)
  default = {
    Project = "amp-enterprise-test"
  }
}
