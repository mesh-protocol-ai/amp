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
