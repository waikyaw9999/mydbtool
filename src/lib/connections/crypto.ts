import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const DEV_SECRET = "dev-only-insecure-mydbtool-secret";

let warnedMissingSecret = false;

export function getConnectionsSecret(): string {
  const secret = process.env.CONNECTIONS_SECRET;
  if (secret && secret.length >= 8) return secret;
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      "[mydbtool] CONNECTIONS_SECRET is unset or too short. Using an insecure development default. Do not use this in production.",
    );
  }
  return DEV_SECRET;
}

function key(): Buffer {
  return scryptSync(getConnectionsSecret(), "mydbtool.v1", 32);
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored password is corrupt. Re-enter the password.");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
