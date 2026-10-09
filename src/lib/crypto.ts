import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@/lib/env";

// AES-256-GCM for OAuth tokens at rest; HMAC for signed OAuth state.
// ENCRYPTION_KEY is 32 random bytes, base64-encoded (`openssl rand -base64 32`).

function key(): Buffer {
  const k = Buffer.from(requireEnv("ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  const mac = createHmac("sha256", key()).update(value).digest("base64url");
  return `${Buffer.from(value).toString("base64url")}.${mac}`;
}

export function verify(signed: string): string | null {
  const [b64, mac] = signed.split(".");
  if (!b64 || !mac) return null;
  const value = Buffer.from(b64, "base64url").toString("utf8");
  const expected = createHmac("sha256", key()).update(value).digest();
  const given = Buffer.from(mac, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}
