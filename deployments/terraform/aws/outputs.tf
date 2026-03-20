# AMP Enterprise test — outputs

output "public_ip" {
  description = "Public IP of the AMP instance (point api.<domain> and nats.<domain> here)"
  value       = aws_eip.amp.public_ip
}

output "api_endpoint" {
  description = "Suggested Registry API base URL after DNS is configured"
  value       = "https://api.${var.domain}"
}

output "nats_endpoint" {
  description = "Suggested NATS URL for SDK (after DNS and optional token)"
  value       = "nats://nats.${var.domain}:4222"
}

output "ssh_command" {
  description = "Example SSH command (replace with your key path)"
  value       = "ssh -i /path/to/your-key.pem ubuntu@${aws_eip.amp.public_ip}"
}

# ── Data Plane Relay outputs ───────────────────────────────────────────────

output "relay_public_host" {
  description = "Value to set as RELAY_PUBLIC_HOST in deployments/public/.env (provider-facing relay address)"
  value       = aws_eip.amp.public_ip
}

output "relay_control_endpoint" {
  description = "Relay control channel — providers connect here to register (relayHost:controlPort)"
  value       = "${aws_eip.amp.public_ip}:7000"
}

output "relay_consumer_port_range" {
  description = "Consumer gRPC port range exposed by the relay"
  value       = "${aws_eip.amp.public_ip}:${var.relay_consumer_port_start}-${var.relay_consumer_port_start + var.relay_consumer_port_size - 1}"
}
