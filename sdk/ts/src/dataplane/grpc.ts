import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProtoPath(): string {
  const candidates = [
    // Built SDK runtime path (dist/dataplane -> dist/proto)
    path.resolve(__dirname, "../proto/amp/dataplane/v1/dataplane.proto"),
    // Source tree path (src/dataplane -> proto)
    path.resolve(__dirname, "../../proto/amp/dataplane/v1/dataplane.proto"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `DataPlane proto file not found. Checked: ${candidates.join(", ")}`
  );
}

const protoPath = resolveProtoPath();

const packageDef = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const loaded = grpc.loadPackageDefinition(packageDef) as any;
const DataPlaneService = loaded.amp.dataplane.v1.DataPlane;

export interface ParsedGrpcEndpoint {
  /** host:port ready to pass to gRPC channel constructor */
  target: string;
  /**
   * Whether the endpoint scheme explicitly requests insecure transport.
   * - `true`  → scheme was `grpc://`  (plain TCP, no TLS)
   * - `false` → scheme was `grpcs://` or absent (TLS)
   *
   * Use this to drive `createDataPlaneClient` when the caller has not set
   * `DATAPLANE_ALLOW_INSECURE` explicitly.
   */
  schemeInsecure: boolean;
}

/**
 * Parse a gRPC endpoint URL into its target string and TLS hint.
 *
 * Supported forms:
 *   grpc://host:port   → insecure (scheme == "grpc")
 *   grpcs://host:port  → TLS      (scheme == "grpcs")
 *   host:port          → TLS by default (no scheme)
 */
export function parseGrpcEndpoint(endpoint: string): string;
export function parseGrpcEndpoint(endpoint: string, structured: true): ParsedGrpcEndpoint;
export function parseGrpcEndpoint(
  endpoint: string,
  structured?: true,
): string | ParsedGrpcEndpoint {
  const raw = String(endpoint || "").trim();
  if (!raw) {
    throw new Error("gRPC endpoint is empty");
  }
  let target: string;
  let schemeInsecure: boolean;
  if (raw.startsWith("grpc://")) {
    target = raw.slice("grpc://".length);
    schemeInsecure = true;
  } else if (raw.startsWith("grpcs://")) {
    target = raw.slice("grpcs://".length);
    schemeInsecure = false;
  } else {
    target = raw;
    schemeInsecure = false; // no scheme → assume TLS
  }
  return structured ? { target, schemeInsecure } : target;
}

function readFileIfExists(filePath: string): Buffer | null {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

export function createDataPlaneClient(
  endpoint: string,
  options: {
    /**
     * Force insecure (plain TCP) transport.
     * When omitted the scheme in `endpoint` is used as a hint:
     *   `grpc://`  → insecure, `grpcs://` or no scheme → TLS.
     */
    insecure?: boolean;
    caCertPath?: string;
    clientCertPath?: string;
    clientKeyPath?: string;
    serverName?: string;
  } = {},
): any {
  const { target, schemeInsecure } = parseGrpcEndpoint(endpoint, true);
  const {
    // If caller didn't set insecure explicitly, fall back to the scheme hint.
    insecure = schemeInsecure,
    caCertPath = "",
    clientCertPath = "",
    clientKeyPath = "",
    serverName = "",
  } = options;
  const creds = insecure
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl(
        readFileIfExists(caCertPath) ?? null,
        readFileIfExists(clientKeyPath) ?? null,
        readFileIfExists(clientCertPath) ?? null,
      );
  const channelOptions: Record<string, string> = {};
  if (serverName) {
    channelOptions["grpc.ssl_target_name_override"] = serverName;
    channelOptions["grpc.default_authority"] = serverName;
  }
  return new DataPlaneService(target, creds, channelOptions);
}

export function createGrpcServer(): grpc.Server {
  return new grpc.Server();
}

export function createServerCredentials(
  options: {
    insecure?: boolean;
    caCertPath?: string;
    serverCertPath?: string;
    serverKeyPath?: string;
    requireClientCert?: boolean;
  } = {},
): grpc.ServerCredentials {
  const {
    insecure = false,
    caCertPath = "",
    serverCertPath = "",
    serverKeyPath = "",
    requireClientCert = false,
  } = options;
  if (insecure) {
    return grpc.ServerCredentials.createInsecure();
  }
  const serverKey = readFileIfExists(serverKeyPath);
  const serverCert = readFileIfExists(serverCertPath);
  if (!serverKey || !serverCert) {
    throw new Error("TLS enabled but server cert/key files are missing");
  }
  const ca = readFileIfExists(caCertPath) ?? null;
  return grpc.ServerCredentials.createSsl(
    ca,
    [{ private_key: serverKey, cert_chain: serverCert }],
    Boolean(requireClientCert),
  );
}

export { DataPlaneService, grpc };
