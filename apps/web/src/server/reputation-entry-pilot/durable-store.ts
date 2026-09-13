import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { canonicalJson, computeEvidenceLedgerEntryHash, sha256Canonical } from "@donelayer/database";

import { assertVersionedDurableRecordPayload } from "./durable-record-versions";

export type DurableRecordType =
  | "AGENT_PROFILE"
  | "AGENT_PROFILE_BINDING"
  | "JOB_IDENTITY"
  | "SOURCE_IDENTITY"
  | "WORK_CONTRACT"
  | "AUTHORITY_LEASE_ISSUED"
  | "EXECUTION_IDENTITY"
  | "EVIDENCE_BUNDLE_INTERMEDIATE"
  | "AGENT_SANDBOX_STARTED"
  | "BASELINE_FAILURE"
  | "AGENT_TOOL_CALL"
  | "AGENT_MODEL_REQUEST"
  | "AGENT_MODEL_RUN"
  | "SOURCE_PATCH"
  | "REPAIR_SOURCE_INTEGRITY"
  | "REPAIR_SANDBOX_CLEANUP"
  | "VERIFIER_SANDBOX_STARTED"
  | "VERIFIER_COMMAND"
  | "VERIFIER_RESULT"
  | "VERIFIER_SANDBOX_CLEANUP"
  | "DELIVERY_OUTCOME_EVALUATION"
  | "AUTHORITY_LEASE_REVOKED"
  | "EVIDENCE_ARTIFACTS"
  | "EVIDENCE_BUNDLE_FINAL"
  | "EVIDENCE_LEDGER_FINAL"
  | "VERIFIED_JOB_RECEIPT"
  | "PILOT_OUTCOME";

export type DurableRecord = {
  id: string;
  jobId: string | null;
  recordType: DurableRecordType;
  recordId: string;
  recordVersion: number;
  payloadSha256: string;
  payload: unknown;
  createdAt: string;
};

export type DurableLifecycleEntry = {
  id: string;
  jobId: string;
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
};

export type DurableJobRecovery = {
  jobId: string;
  records: DurableRecord[];
  lifecycle: DurableLifecycleEntry[];
  recordTypes: DurableRecordType[];
  lifecycleChainSha256: string | null;
  integrityValid: boolean;
};

export type DurableStoreVerification = {
  valid: boolean;
  recordCount: number;
  lifecycleEntryCount: number;
  jobCount: number;
  historicalMarkerSha256: string;
};

type RecordRow = {
  id: string;
  job_id: string | null;
  record_type: string;
  record_id: string;
  record_version: number;
  payload_sha256: string;
  payload_json: string;
  created_at: string;
};

type LifecycleRow = {
  id: string;
  job_id: string;
  sequence_number: number;
  entry_type: string;
  source_record_type: string;
  source_record_id: string;
  payload_sha256: string;
  previous_entry_sha256: string | null;
  entry_sha256: string;
  created_at: string;
};

export class ReputationEntryDurableStore {
  private readonly database: DatabaseSync;
  private readonly historicalMarkerPath: string;
  private readonly readOnly: boolean;
  private closed = false;

  constructor(
    readonly databasePath: string,
    input: { historicalMarkerPath: string; readOnly?: boolean },
  ) {
    if (!path.isAbsolute(databasePath) || !path.isAbsolute(input.historicalMarkerPath)) {
      throw new Error("REPUTATION_ENTRY_DURABLE_PATH_MUST_BE_ABSOLUTE");
    }
    this.readOnly = input.readOnly ?? false;
    if (this.readOnly && !existsSync(databasePath)) throw new Error("REPUTATION_ENTRY_DURABLE_DATABASE_MISSING");
    if (!this.readOnly) mkdirSync(path.dirname(databasePath), { recursive: true });
    this.historicalMarkerPath = input.historicalMarkerPath;
    const databaseLocation = this.readOnly ? immutableSqliteUrl(databasePath) : databasePath;
    this.database = new DatabaseSync(databaseLocation, { readOnly: this.readOnly });
    try {
      if (this.readOnly) {
        this.database.exec("PRAGMA query_only=ON; PRAGMA foreign_keys=ON;");
        this.assertHistoricalMarkerIntegrity();
      } else {
        this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
        this.initializeSchema();
        this.bindHistoricalMarker();
      }
    } catch (initializationError) {
      try {
        this.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [initializationError, cleanupError],
          "REPUTATION_ENTRY_DURABLE_STORE_INITIALIZATION_AND_CLEANUP_FAILED",
          { cause: initializationError },
        );
      }
      throw initializationError;
    }
  }

  appendRecord(input: {
    jobId?: string | null;
    recordType: DurableRecordType;
    recordId: string;
    recordVersion?: number;
    payload: unknown;
    createdAt?: string;
  }): DurableRecord {
    this.assertOpen();
    if (this.readOnly) throw new Error("REPUTATION_ENTRY_DURABLE_STORE_READ_ONLY");
    const jobId = input.jobId ?? null;
    const recordId = requiredText(input.recordId, "Durable record ID");
    const recordVersion = input.recordVersion ?? 1;
    if (!Number.isSafeInteger(recordVersion) || recordVersion < 1) throw new Error("DURABLE_RECORD_VERSION_INVALID");
    const createdAt = validTimestamp(input.createdAt ?? new Date().toISOString());
    const payloadJson = canonicalJson(input.payload);
    const payloadSha256 = sha256Canonical(input.payload);
    const existing = this.database.prepare(`
      SELECT id,job_id,record_type,record_id,record_version,payload_sha256,payload_json,created_at
      FROM durable_records WHERE record_type=? AND record_id=? AND record_version=?
    `).get(input.recordType, recordId, recordVersion) as RecordRow | undefined;
    if (existing) {
      if (
        existing.job_id !== jobId ||
        existing.payload_sha256 !== payloadSha256 ||
        existing.payload_json !== payloadJson
      ) throw new Error("DURABLE_RECORD_OVERWRITE_DENIED");
      return recordFromRow(existing);
    }
    const id = randomUUID();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("INSERT INTO durable_records VALUES(?,?,?,?,?,?,?,?)").run(
        id,
        jobId,
        input.recordType,
        recordId,
        recordVersion,
        payloadSha256,
        payloadJson,
        createdAt,
      );
      if (jobId) this.appendLifecycleEntry(jobId, input.recordType, recordId, payloadSha256, createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { id, jobId, recordType: input.recordType, recordId, recordVersion, payloadSha256, payload: structuredClone(input.payload), createdAt };
  }

  recoverJob(jobIdInput: string): DurableJobRecovery {
    this.assertOpen();
    const jobId = requiredText(jobIdInput, "Recovery Job ID");
    const records = (this.database.prepare(`
      SELECT id,job_id,record_type,record_id,record_version,payload_sha256,payload_json,created_at
      FROM durable_records WHERE job_id=? ORDER BY rowid
    `).all(jobId) as unknown as RecordRow[]).map(recordFromRow);
    const lifecycle = (this.database.prepare(`
      SELECT id,job_id,sequence_number,entry_type,source_record_type,source_record_id,payload_sha256,
             previous_entry_sha256,entry_sha256,created_at
      FROM durable_lifecycle WHERE job_id=? ORDER BY sequence_number
    `).all(jobId) as unknown as LifecycleRow[]).map(lifecycleFromRow);
    let previous: string | null = null;
    let valid = records.length > 0 && records.length === lifecycle.length;
    const recordBindings = new Map<string, DurableRecord[]>();
    for (const record of records) {
      const key = lifecycleBindingKey(record.recordType, record.recordId, record.payloadSha256);
      recordBindings.set(key, [...(recordBindings.get(key) ?? []), record]);
    }
    for (const [index, entry] of lifecycle.entries()) {
      const boundRecords = recordBindings.get(lifecycleBindingKey(
        entry.sourceRecordType,
        entry.sourceRecordId,
        entry.payloadSha256,
      )) ?? [];
      if (
        entry.sequenceNumber !== index + 1 ||
        entry.previousEntrySha256 !== previous ||
        computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256 ||
        boundRecords.length !== 1
      ) valid = false;
      if (boundRecords.length === 1) {
        try { assertDurableRecordIntegrity(boundRecords[0]!); } catch { valid = false; }
      }
      previous = entry.entrySha256;
    }
    return {
      jobId,
      records,
      lifecycle,
      recordTypes: records.map((record) => record.recordType),
      lifecycleChainSha256: previous,
      integrityValid: valid,
    };
  }

  getRecord(recordType: DurableRecordType, recordId: string, recordVersion = 1): DurableRecord | null {
    this.assertOpen();
    const row = this.database.prepare(`
      SELECT id,job_id,record_type,record_id,record_version,payload_sha256,payload_json,created_at
      FROM durable_records WHERE record_type=? AND record_id=? AND record_version=?
    `).get(recordType, recordId, recordVersion) as RecordRow | undefined;
    return row ? recordFromRow(row) : null;
  }

  verifyAll(): DurableStoreVerification {
    this.assertOpen();
    this.assertHistoricalMarkerIntegrity();
    const rows = this.database.prepare(`
      SELECT id,job_id,record_type,record_id,record_version,payload_sha256,payload_json,created_at
      FROM durable_records ORDER BY rowid
    `).all() as unknown as RecordRow[];
    let valid = true;
    const jobIds = new Set<string>();
    for (const row of rows) {
      let payload: unknown;
      try { payload = JSON.parse(row.payload_json); } catch { valid = false; continue; }
      const record = recordFromRow(row);
      try { assertDurableRecordIntegrity(record); } catch { valid = false; }
      if (canonicalJson(payload) !== row.payload_json) valid = false;
      if (row.job_id) jobIds.add(row.job_id);
    }
    let lifecycleEntryCount = 0;
    for (const jobId of jobIds) {
      const recovery = this.recoverJob(jobId);
      lifecycleEntryCount += recovery.lifecycle.length;
      if (!recovery.integrityValid) valid = false;
    }
    const unboundLifecycleCount = (this.database.prepare(`
      SELECT COUNT(*) AS count FROM durable_lifecycle
      WHERE job_id NOT IN (SELECT DISTINCT job_id FROM durable_records WHERE job_id IS NOT NULL)
    `).get() as { count: number }).count;
    if (unboundLifecycleCount !== 0) valid = false;
    return {
      valid,
      recordCount: rows.length,
      lifecycleEntryCount,
      jobCount: jobIds.size,
      historicalMarkerSha256: this.historicalMarkerSha256(),
    };
  }

  assertHistoricalMarkerIntegrity(): void {
    this.assertOpen();
    const expected = this.database.prepare("SELECT value FROM persistence_meta WHERE key='historical_marker_sha256'").get() as { value: string } | undefined;
    if (!expected || expected.value !== this.historicalMarkerSha256()) {
      throw new Error("HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH");
    }
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS persistence_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS durable_records (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_version INTEGER NOT NULL CHECK(record_version >= 1),
        payload_sha256 TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(record_type, record_id, record_version)
      );
      CREATE TABLE IF NOT EXISTS durable_lifecycle (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        source_record_type TEXT NOT NULL,
        source_record_id TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        previous_entry_sha256 TEXT,
        entry_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(job_id, sequence_number)
      );
      CREATE TRIGGER IF NOT EXISTS durable_records_no_update BEFORE UPDATE ON durable_records
      BEGIN SELECT RAISE(ABORT, 'Durable records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS durable_records_no_delete BEFORE DELETE ON durable_records
      BEGIN SELECT RAISE(ABORT, 'Durable records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS durable_lifecycle_no_update BEFORE UPDATE ON durable_lifecycle
      BEGIN SELECT RAISE(ABORT, 'Durable lifecycle is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS durable_lifecycle_no_delete BEFORE DELETE ON durable_lifecycle
      BEGIN SELECT RAISE(ABORT, 'Durable lifecycle is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS persistence_meta_no_update BEFORE UPDATE ON persistence_meta
      BEGIN SELECT RAISE(ABORT, 'Persistence metadata is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS persistence_meta_no_delete BEFORE DELETE ON persistence_meta
      BEGIN SELECT RAISE(ABORT, 'Persistence metadata is immutable'); END;
    `);
  }

  private bindHistoricalMarker(): void {
    const observed = this.historicalMarkerSha256();
    const existing = this.database.prepare("SELECT value FROM persistence_meta WHERE key='historical_marker_sha256'").get() as { value: string } | undefined;
    if (!existing) {
      this.database.prepare("INSERT INTO persistence_meta(key,value) VALUES('historical_marker_sha256',?)").run(observed);
    } else if (existing.value !== observed) {
      throw new Error("HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH");
    }
  }

  private historicalMarkerSha256(): string {
    let bytes: Buffer;
    try { bytes = readFileSync(this.historicalMarkerPath); } catch {
      throw new Error("HISTORICAL_PILOT_MARKER_MISSING");
    }
    return createHash("sha256").update(bytes).digest("hex");
  }

  private appendLifecycleEntry(
    jobId: string,
    recordType: DurableRecordType,
    recordId: string,
    payloadSha256: string,
    createdAt: string,
  ): void {
    const previous = this.database.prepare(`
      SELECT sequence_number,entry_sha256 FROM durable_lifecycle WHERE job_id=? ORDER BY sequence_number DESC LIMIT 1
    `).get(jobId) as { sequence_number: number; entry_sha256: string } | undefined;
    const entry: DurableLifecycleEntry = {
      id: randomUUID(),
      jobId,
      sequenceNumber: (previous?.sequence_number ?? 0) + 1,
      entryType: `DURABLE_${recordType}`,
      sourceRecordType: recordType,
      sourceRecordId: recordId,
      payloadSha256,
      previousEntrySha256: previous?.entry_sha256 ?? null,
      entrySha256: "",
      createdAt,
    };
    entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
    this.database.prepare("INSERT INTO durable_lifecycle VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      entry.id,
      entry.jobId,
      entry.sequenceNumber,
      entry.entryType,
      entry.sourceRecordType,
      entry.sourceRecordId,
      entry.payloadSha256,
      entry.previousEntrySha256,
      entry.entrySha256,
      entry.createdAt,
    );
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("REPUTATION_ENTRY_DURABLE_STORE_CLOSED");
  }
}

function recordFromRow(row: RecordRow): DurableRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    recordType: row.record_type as DurableRecordType,
    recordId: row.record_id,
    recordVersion: row.record_version,
    payloadSha256: row.payload_sha256,
    payload: JSON.parse(row.payload_json),
    createdAt: row.created_at,
  };
}

function lifecycleFromRow(row: LifecycleRow): DurableLifecycleEntry {
  return {
    id: row.id,
    jobId: row.job_id,
    sequenceNumber: row.sequence_number,
    entryType: row.entry_type,
    sourceRecordType: row.source_record_type,
    sourceRecordId: row.source_record_id,
    payloadSha256: row.payload_sha256,
    previousEntrySha256: row.previous_entry_sha256,
    entrySha256: row.entry_sha256,
    createdAt: row.created_at,
  };
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function assertDurableRecordIntegrity(record: DurableRecord): void {
  if (!Number.isSafeInteger(record.recordVersion) || record.recordVersion < 1) {
    throw new Error("DURABLE_RECORD_VERSION_INVALID");
  }
  if (sha256Canonical(record.payload) !== record.payloadSha256) {
    throw new Error("DURABLE_RECORD_PAYLOAD_HASH_MISMATCH");
  }
  assertVersionedDurableRecordPayload(record);
}

function lifecycleBindingKey(recordType: string, recordId: string, payloadSha256: string): string {
  return `${recordType}:${recordId}:${payloadSha256}`;
}

function immutableSqliteUrl(databasePath: string): URL {
  const url = pathToFileURL(databasePath);
  url.searchParams.set("immutable", "1");
  return url;
}

function validTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error("DURABLE_RECORD_TIMESTAMP_INVALID");
  return value;
}
