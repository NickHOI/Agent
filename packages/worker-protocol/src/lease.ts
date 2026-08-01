export type Lease = {
  expiresAt: Date;
  revokedAt?: Date | null | undefined;
};

export function isLeaseActive(lease: Lease, now = new Date()): boolean {
  return !lease.revokedAt && lease.expiresAt.getTime() > now.getTime();
}

export function assertLeaseActive(lease: Lease, now = new Date()): void {
  if (!isLeaseActive(lease, now)) {
    throw new Error("Job lease has expired or was revoked");
  }
}

export function renewLease(lease: Lease, now = new Date(), ttlMs = 45_000): Lease {
  assertLeaseActive(lease, now);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 5_000 || ttlMs > 5 * 60_000) {
    throw new Error("Lease TTL must be between 5 seconds and 5 minutes");
  }
  return { ...lease, expiresAt: new Date(now.getTime() + ttlMs) };
}
