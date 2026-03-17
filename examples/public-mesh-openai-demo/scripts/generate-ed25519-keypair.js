#!/usr/bin/env node
import crypto from "node:crypto";

const roleArg = process.argv[2] || "consumer";
const role = String(roleArg).toUpperCase();

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const privatePkcs8Base64 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const publicSpkiBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

console.log(`# ${role} keypair (Ed25519)`);
console.log(`# Private key format: PKCS8 DER base64`);
console.log(`# Public key format: SPKI DER base64`);
console.log(`${role}_ED25519_PRIVATE_KEY_BASE64=${privatePkcs8Base64}`);
console.log(`${role}_ED25519_PUBLIC_KEY_BASE64=${publicSpkiBase64}`);
