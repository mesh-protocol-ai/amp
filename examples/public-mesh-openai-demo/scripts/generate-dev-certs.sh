#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:-./certs/dev}"
DAYS="${DAYS:-365}"

mkdir -p "${OUTPUT_DIR}"

CA_KEY="${OUTPUT_DIR}/ca.key"
CA_CERT="${OUTPUT_DIR}/ca.crt"
SERVER_KEY="${OUTPUT_DIR}/server.key"
SERVER_CSR="${OUTPUT_DIR}/server.csr"
SERVER_CERT="${OUTPUT_DIR}/server.crt"
CLIENT_KEY="${OUTPUT_DIR}/client.key"
CLIENT_CSR="${OUTPUT_DIR}/client.csr"
CLIENT_CERT="${OUTPUT_DIR}/client.crt"
EXT_FILE="${OUTPUT_DIR}/server.ext"

openssl genrsa -out "${CA_KEY}" 4096 >/dev/null 2>&1
openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days "${DAYS}" \
  -subj "/CN=mesh-dev-ca" -out "${CA_CERT}" >/dev/null 2>&1

openssl genrsa -out "${SERVER_KEY}" 4096 >/dev/null 2>&1
openssl req -new -key "${SERVER_KEY}" -subj "/CN=localhost" -out "${SERVER_CSR}" >/dev/null 2>&1
cat >"${EXT_FILE}" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF
openssl x509 -req -in "${SERVER_CSR}" -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial \
  -out "${SERVER_CERT}" -days "${DAYS}" -sha256 -extfile "${EXT_FILE}" >/dev/null 2>&1

openssl genrsa -out "${CLIENT_KEY}" 4096 >/dev/null 2>&1
openssl req -new -key "${CLIENT_KEY}" -subj "/CN=mesh-dev-client" -out "${CLIENT_CSR}" >/dev/null 2>&1
openssl x509 -req -in "${CLIENT_CSR}" -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial \
  -out "${CLIENT_CERT}" -days "${DAYS}" -sha256 >/dev/null 2>&1

rm -f "${SERVER_CSR}" "${CLIENT_CSR}" "${EXT_FILE}" "${OUTPUT_DIR}/ca.srl"

echo "Dev certs generated:"
echo "  CA:      ${CA_CERT}"
echo "  Server:  ${SERVER_CERT} / ${SERVER_KEY}"
echo "  Client:  ${CLIENT_CERT} / ${CLIENT_KEY}"
