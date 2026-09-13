import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DemoStore,
  computeEvidenceLedgerEntryHash,
  sha256Canonical,
  verifyEvidenceLedgerEntries,
  type EvidenceLedgerEntryRecord,
  type EvidenceLedgerEntryType,
} from "@donelayer/database";

const stores: DemoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("Evidence Ledger v1", () => {
  it("builds a deterministic, contiguous hash chain in insertion order", () => {
    const first = ledgerEntry(1, null, "CONTRACT_LOCKED", { contractVersion: 1 });
    const second = ledgerEntry(2, first.entrySha256, "PERMISSION_GRANTED", { version: 1 });
    const third = ledgerEntry(3, second.entrySha256, "JOB_CLAIMED", { leaseId: "lease-1" });

    expect(verifyEvidenceLedgerEntries([])).toEqual({
      valid: true,
      entryCount: 0,
      chainSha256: null,
      invalidSequence: null,
      reason: null,
    });
    expect(verifyEvidenceLedgerEntries([first, second, third])).toEqual({
      valid: true,
      entryCount: 3,
      chainSha256: third.entrySha256,
      invalidSequence: null,
      reason: null,
    });
    expect(second.previousEntrySha256).toBe(first.entrySha256);
    expect(third.previousEntrySha256).toBe(second.entrySha256);
  });

  it("detects field tampering, broken links, removal, and reordering", () => {
    const first = ledgerEntry(1, null, "CONTRACT_LOCKED", { contractVersion: 1 });
    const second = ledgerEntry(2, first.entrySha256, "PERMISSION_GRANTED", { version: 1 });
    const third = ledgerEntry(3, second.entrySha256, "JOB_CLAIMED", { leaseId: "lease-1" });

    const tampered = structuredClone([first, second, third]);
    tampered[1]!.sourceRecordId = "tampered-source";
    expect(verifyEvidenceLedgerEntries(tampered)).toMatchObject({
      valid: false,
      invalidSequence: 2,
      reason: expect.stringMatching(/hash does not match/i),
    });

    const brokenLink = structuredClone([first, second, third]);
    brokenLink[2]!.previousEntrySha256 = "0".repeat(64);
    expect(verifyEvidenceLedgerEntries(brokenLink)).toMatchObject({
      valid: false,
      invalidSequence: 3,
      reason: expect.stringMatching(/previous entry hash/i),
    });
    expect(verifyEvidenceLedgerEntries([first, third])).toMatchObject({
      valid: false,
      invalidSequence: 3,
      reason: expect.stringMatching(/sequence.*contiguous/i),
    });
    expect(verifyEvidenceLedgerEntries([second, first, third])).toMatchObject({
      valid: false,
      invalidSequence: 2,
      reason: expect.stringMatching(/sequence.*contiguous/i),
    });
  });

  it("appends server-generated hashes and enforces append-only SQLite records", () => {
    const store = createStore();
    const worker = store.createWorker("provider-alpha", "Evidence Worker", "WINDOWS");
    const aggregate = store.createWorkerSmokeTask(worker.id);
    if (!aggregate.jobRun) throw new Error("Smoke Job was not created");
    const before = store.listEvidenceLedgerEntries(aggregate.jobRun.id);

    const artifactCreated = store.appendEvidenceLedgerEntry(
      aggregate.jobRun.id,
      "ARTIFACT_CREATED",
      "evidence_artifact",
      "artifact-test",
      { fileName: "hello.txt", size: 128 },
      "2026-08-26T12:00:10.000Z",
    );
    const workspaceCleaned = store.appendEvidenceLedgerEntry(
      aggregate.jobRun.id,
      "WORKSPACE_CLEANED",
      "job_run_event",
      "cleanup-test",
      { cleaned: true },
      "2026-08-26T12:00:11.000Z",
    );

    expect(artifactCreated.sequenceNumber).toBe(before.length + 1);
    expect(workspaceCleaned.sequenceNumber).toBe(before.length + 2);
    expect(workspaceCleaned.previousEntrySha256).toBe(artifactCreated.entrySha256);
    expect(store.verifyLedgerChain(aggregate.jobRun.id)).toMatchObject({
      valid: true,
      chainSha256: workspaceCleaned.entrySha256,
    });

    const db = databaseOf(store);
    expect(() =>
      db.prepare("UPDATE evidence_ledger_entries SET source_record_id=? WHERE id=?").run(
        "tampered",
        artifactCreated.id,
      ),
    ).toThrow(/append-only/i);
    expect(() =>
      db.prepare("DELETE FROM evidence_ledger_entries WHERE id=?").run(artifactCreated.id),
    ).toThrow(/append-only/i);
    expect(store.verifyLedgerChain(aggregate.jobRun.id).valid).toBe(true);
  });
});

function ledgerEntry(
  sequenceNumber: number,
  previousEntrySha256: string | null,
  entryType: EvidenceLedgerEntryType,
  payload: unknown,
): EvidenceLedgerEntryRecord {
  const createdAt = new Date(Date.UTC(2026, 7, 26, 12, 0, sequenceNumber)).toISOString();
  const entry = {
    id: randomUUID(),
    taskId: randomUUID(),
    jobRunId: randomUUID(),
    sequenceNumber,
    entryType,
    sourceRecordType: "test_source",
    sourceRecordId: `source-${sequenceNumber}`,
    payloadSha256: sha256Canonical(payload),
    previousEntrySha256,
    createdAt,
  };
  return {
    ...entry,
    entrySha256: computeEvidenceLedgerEntryHash(entry),
  };
}

function createStore(): DemoStore {
  const store = new DemoStore(":memory:");
  stores.push(store);
  return store;
}

function databaseOf(store: DemoStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}
