import { createHash, randomBytes } from "node:crypto";

export function createToken(size = 24) {
  return randomBytes(size).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
