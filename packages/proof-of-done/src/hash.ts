import { createHash, timingSafeEqual } from "node:crypto";

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : value;
}

export function computeEvidenceSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(toBytes(value)).digest("hex");
}

export function getEvidenceDigest(value: string | Uint8Array): {
  sha256: string;
  size: number;
} {
  const bytes = toBytes(value);
  return {
    sha256: computeEvidenceSha256(bytes),
    size: bytes.byteLength,
  };
}

export function verifyEvidenceSha256(
  value: string | Uint8Array,
  expectedSha256: string,
): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    return false;
  }

  const actual = Buffer.from(computeEvidenceSha256(value), "hex");
  const expected = Buffer.from(expectedSha256, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
