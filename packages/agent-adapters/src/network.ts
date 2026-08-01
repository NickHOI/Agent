import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export type HostResolver = (hostname: string) => Promise<string[]>;

export type ResolvedHttpsEndpoint = {
  url: URL;
  addresses: string[];
};

const defaultResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export async function assertSafeHttpsEndpoint(
  value: string,
  resolveHostname: HostResolver = defaultResolver,
): Promise<URL> {
  return (await resolveSafeHttpsEndpoint(value, resolveHostname)).url;
}

export async function resolveSafeHttpsEndpoint(
  value: string,
  resolveHostname: HostResolver = defaultResolver,
): Promise<ResolvedHttpsEndpoint> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Endpoint must be a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Endpoint must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Endpoint URL must not contain credentials");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Endpoint must use the default HTTPS port");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local endpoints are not allowed");
  }

  const addresses = isIP(hostname) ? [hostname] : await resolveHostname(hostname);
  if (addresses.length === 0) {
    throw new Error("Endpoint hostname did not resolve");
  }
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new Error("Endpoint resolves to a private or reserved address");
  }
  return { url, addresses };
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 0 && octets[2] === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && octets[2] === 100) ||
      (a === 203 && b === 0 && octets[2] === 113) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const segments = parseIpv6Segments(address);
    if (!segments) return true;
    const first = segments[0] ?? 0;
    const allZeroPrefix = segments.slice(0, 6).every((segment) => segment === 0);
    if (allZeroPrefix && (segments[6] !== 0 || segments[7] !== 0)) {
      const mapped = `${(segments[6] ?? 0) >> 8}.${(segments[6] ?? 0) & 255}.${
        (segments[7] ?? 0) >> 8
      }.${(segments[7] ?? 0) & 255}`;
      if (isPrivateOrReservedAddress(mapped)) return true;
    }
    const ipv4Mapped =
      segments.slice(0, 5).every((segment) => segment === 0) && segments[5] === 0xffff;
    if (ipv4Mapped) {
      const mapped = `${(segments[6] ?? 0) >> 8}.${(segments[6] ?? 0) & 255}.${
        (segments[7] ?? 0) >> 8
      }.${(segments[7] ?? 0) & 255}`;
      return isPrivateOrReservedAddress(mapped);
    }
    return (
      segments.every((segment) => segment === 0) ||
      (segments.slice(0, 7).every((segment) => segment === 0) && segments[7] === 1) ||
      (first & 0xfe00) === 0xfc00 ||
      (first & 0xffc0) === 0xfe80 ||
      (first & 0xffc0) === 0xfec0 ||
      first === 0xff00 ||
      (first === 0x2001 && segments[1] === 0x0db8) ||
      (first & 0xe000) !== 0x2000
    );
  }
  return true;
}

export async function readResponseBodyLimited(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Response byte limit must be a positive integer");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Response body is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Response body is too large");
        throw new Error("Response body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function pinnedHttpsFetch(
  endpoint: ResolvedHttpsEndpoint,
  init: {
    method: "GET" | "POST";
    headers?: HeadersInit;
    body?: string | Uint8Array;
    signal?: AbortSignal;
  },
  maxResponseBytes: number,
): Promise<Response> {
  const address = endpoint.addresses[0];
  if (!address || isPrivateOrReservedAddress(address)) {
    throw new Error("Pinned endpoint address is unavailable or unsafe");
  }
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    headers.set("host", endpoint.url.host);
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: address,
        port: 443,
        method: init.method,
        path: `${endpoint.url.pathname}${endpoint.url.search}`,
        headers: Object.fromEntries(headers.entries()),
        ...(isIP(endpoint.url.hostname.replace(/^\[|\]$/g, ""))
          ? {}
          : { servername: endpoint.url.hostname }),
        rejectUnauthorized: true,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let total = 0;
        incoming.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxResponseBytes) {
            incoming.destroy(new Error("Response body is too large"));
            return;
          }
          chunks.push(chunk);
        });
        incoming.once("error", reject);
        incoming.once("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            } else if (value !== undefined) responseHeaders.set(name, value);
          }
          resolve(
            new Response(
              [204, 205, 304].includes(incoming.statusCode ?? 500) ? null : Buffer.concat(chunks),
              {
              status: incoming.statusCode ?? 500,
              ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
              headers: responseHeaders,
              },
            ),
          );
        });
      },
    );
    request.once("error", reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

function parseIpv6Segments(address: string): number[] | null {
  const withoutZone = address.toLowerCase().split("%", 1)[0] ?? "";
  let normalized = withoutZone;
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1).split(".").map(Number);
    if (
      ipv4.length !== 4 ||
      ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null;
    }
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const values = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) =>
    Number.parseInt(part, 16),
  );
  return values.length === 8 && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? values
    : null;
}
