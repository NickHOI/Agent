import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type PairingCodeRecord = {
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashSecret(secret: string, pepper: string): string {
  if (!pepper) {
    throw new Error("A server-side pepper is required");
  }
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}

export function generateOpaqueToken(bytes = 32): string {
  if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new Error("Token size must be between 16 and 128 bytes");
  }
  return randomBytes(bytes).toString("base64url");
}

export function createPairingCode(
  pepper: string,
  now = new Date(),
  ttlMs = 10 * 60 * 1_000,
): { code: string; record: PairingCodeRecord } {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const raw = [...randomBytes(12)]
    .map((byte) => alphabet.charAt(byte & 31))
    .join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  return {
    code,
    record: {
      codeHash: hashSecret(normalizePairingCode(code), pepper),
      expiresAt: new Date(now.getTime() + ttlMs),
      usedAt: null,
    },
  };
}

export function consumePairingCode(
  code: string,
  record: PairingCodeRecord,
  pepper: string,
  now = new Date(),
): PairingCodeRecord {
  if (record.usedAt) {
    throw new Error("Pairing code has already been used");
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    throw new Error("Pairing code has expired");
  }
  const candidate = hashSecret(normalizePairingCode(code), pepper);
  if (!constantTimeHexEqual(candidate, record.codeHash)) {
    throw new Error("Pairing code is invalid");
  }
  return { ...record, usedAt: now };
}

export function normalizePairingCode(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (
    left.length !== right.length ||
    left.length % 2 !== 0 ||
    !/^[a-f0-9]+$/i.test(left) ||
    !/^[a-f0-9]+$/i.test(right)
  ) {
    return false;
  }
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function redactSecrets(value: string): string {
  return value
    .replace(
      /(\b(?:authorization|worker[_-]?token|lease[_-]?token|pairing[_-]?code|webhook[_-]?secret|github[_-]?token)\b["']?\s*[:=]\s*)(?:["']?Bearer\s+)?["']?[^\s,"'}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_-]{12,}|sk[-_][A-Za-z0-9_-]{12,}|whsec_[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
      "[REDACTED]",
    );
}

export function redactStructuredValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    output[key] = [
      "authorization",
      "workertoken",
      "leasetoken",
      "pairingcode",
      "webhooksecret",
      "githubtoken",
      "apikey",
      "password",
      "cookie",
      "setcookie",
    ].includes(normalizedKey)
      ? "[REDACTED]"
      : redactStructuredValue(child, depth + 1);
  }
  return output;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes < 0) {
    throw new Error("maxBytes must not be negative");
  }
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) {
    return value;
  }
  const suffix = Buffer.from("[TRUNCATED]", "utf8");
  if (maxBytes <= suffix.length) {
    let shortPrefix = "";
    for (const character of value) {
      if (Buffer.byteLength(`${shortPrefix}${character}`, "utf8") > maxBytes) break;
      shortPrefix += character;
    }
    return shortPrefix;
  }
  let prefix = bytes.subarray(0, maxBytes - suffix.length).toString("utf8");
  const suffixText = suffix.toString("utf8");
  while (Buffer.byteLength(`${prefix}${suffixText}`, "utf8") > maxBytes) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix}${suffixText}`;
}
