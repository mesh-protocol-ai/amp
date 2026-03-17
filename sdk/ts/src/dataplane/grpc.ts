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

export function parseGrpcEndpoint(endpoint: string): string {
  const raw = String(endpoint || "").trim();
  if (!raw) {
    throw new Error("gRPC endpoint is empty");
  }
  if (raw.startsWith("grpc://")) {
    return raw.replace("grpc://", "");
  }
  if (raw.startsWith("grpcs://")) {
    return raw.replace("grpcs://", "");
  }
  return raw;
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
    insecure?: boolean;
    caCertPath?: string;
    clientCertPath?: string;
    clientKeyPath?: string;
    serverName?: string;
  } = {},
): any {
  const target = parseGrpcEndpoint(endpoint);
  const {
    insecure = false,
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
