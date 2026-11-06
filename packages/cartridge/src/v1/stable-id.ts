import { createHash } from "node:crypto";

/**
 * A deterministic UUID v7: the timestamp is fixed (`timestampMs`), and the remaining bits come from a
 * SHA-256 of `namespace:key`. So importing the same v1 event again gives the same ids, and the documents
 * are updated rather than duplicated. Same bit layout as the original Circus 2026 transcode.
 */
export function stableUuid7(
  namespace: string,
  key: string,
  timestampMs: number,
): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(timestampMs, 0, 6);
  createHash("sha256")
    .update(`${namespace}:${key}`)
    .digest()
    .copy(bytes, 6, 0, 10);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6); // version 7
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
