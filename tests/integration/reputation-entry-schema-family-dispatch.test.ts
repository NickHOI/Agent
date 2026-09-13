import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { canonicalJson, sha256Canonical } from "@donelayer/database";

import {
  assertDurableRecordPayloadForSchemaFamily,
  assertVersionedDurableRecordPayload,
  identifyDurableRecordSchemaFamily,
} from "../../apps/web/src/server/reputation-entry-pilot/durable-record-versions";
import { ReputationEntryDurableStore } from "../../apps/web/src/server/reputation-entry-pilot/durable-store";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const historicalMarkerPath = path.join(resultDirectory, "reputation-entry-pilot-attempt-1-recovered.json");
const attempt4DatabasePath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4.sqlite");
const attempt3DatabasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3.sqlite");
const attempt3EvidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-evidence.json");
const v2EvidencePath = path.join(resultDirectory, "verified-delivery-outcome-policy-v1-evidence.json");
const hasEvidence = [
  historicalMarkerPath,
  attempt4DatabasePath,
  attempt3DatabasePath,
  attempt3EvidencePath,
  v2EvidencePath,
].every(existsSync);

type FamilyRecord = {
  recordType: "EVIDENCE_BUNDLE_FINAL" | "VERIFIED_JOB_RECEIPT";
  recordVersion: number;
  payload: unknown;
};

let preflightBundle: FamilyRecord;
let preflightReceipt: FamilyRecord;
let reputationBundle: FamilyRecord;
let reputationReceipt: FamilyRecord;
let outcomeBundle: FamilyRecord;
let outcomeReceipt: FamilyRecord;

describe.skipIf(!hasEvidence)("durable schema-family dispatch", () => {
  beforeAll(() => {
    const attempt4 = new ReputationEntryDurableStore(attempt4DatabasePath, {
      historicalMarkerPath,
      readOnly: true,
    });
    try {
      preflightBundle = familyRecord(attempt4.getRecord(
        "EVIDENCE_BUNDLE_FINAL",
        "job_persistence_preflight_0001:bundle",
        1,
      ));
      preflightReceipt = familyRecord(attempt4.getRecord(
        "VERIFIED_JOB_RECEIPT",
        "job_persistence_preflight_0001:receipt",
        1,
      ));
    } finally {
      attempt4.close();
    }

    const attempt3Evidence = JSON.parse(readFileSync(attempt3EvidencePath, "utf8")) as {
      outcome: { jobs: Array<{ evidenceBundle: { bundleSha256: string }; receipt: { id: string } }> };
    };
    const historicalJob = attempt3Evidence.outcome.jobs[0]!;
    const attempt3 = new ReputationEntryDurableStore(attempt3DatabasePath, {
      historicalMarkerPath,
      readOnly: true,
    });
    try {
      reputationBundle = familyRecord(attempt3.getRecord(
        "EVIDENCE_BUNDLE_FINAL",
        historicalJob.evidenceBundle.bundleSha256,
        1,
      ));
      reputationReceipt = familyRecord(attempt3.getRecord(
        "VERIFIED_JOB_RECEIPT",
        historicalJob.receipt.id,
        1,
      ));
    } finally {
      attempt3.close();
    }

    const v2Evidence = JSON.parse(readFileSync(v2EvidencePath, "utf8")) as {
      prospectiveReceiptTestVector: { evidenceBundle: unknown; receipt: unknown };
    };
    outcomeBundle = {
      recordType: "EVIDENCE_BUNDLE_FINAL",
      recordVersion: 2,
      payload: v2Evidence.prospectiveReceiptTestVector.evidenceBundle,
    };
    outcomeReceipt = {
      recordType: "VERIFIED_JOB_RECEIPT",
      recordVersion: 2,
      payload: v2Evidence.prospectiveReceiptTestVector.receipt,
    };
  });

  it("validates the exact Attempt 4 Persistence Preflight Bundle V1", () => {
    expect(() => assertVersionedDurableRecordPayload(preflightBundle)).not.toThrow();
    expect(identifyDurableRecordSchemaFamily(preflightBundle)).toBe("PERSISTENCE_PREFLIGHT_V1");
  });

  it("validates the exact Attempt 4 Persistence Preflight Receipt V1", () => {
    expect(() => assertVersionedDurableRecordPayload(preflightReceipt)).not.toThrow();
    expect(identifyDurableRecordSchemaFamily(preflightReceipt)).toBe("PERSISTENCE_PREFLIGHT_V1");
  });

  it("validates the exact Reputation Entry Bundle V1", () => {
    expect(() => assertVersionedDurableRecordPayload(reputationBundle)).not.toThrow();
    expect(identifyDurableRecordSchemaFamily(reputationBundle)).toBe("REPUTATION_ENTRY_V1");
  });

  it("validates the exact Reputation Entry Receipt V1", () => {
    expect(() => assertVersionedDurableRecordPayload(reputationReceipt)).not.toThrow();
    expect(identifyDurableRecordSchemaFamily(reputationReceipt)).toBe("REPUTATION_ENTRY_V1");
  });

  it("validates the accepted Verified Delivery Bundle V2", () => {
    expect(() => assertVersionedDurableRecordPayload(outcomeBundle)).not.toThrow();
    expect(identifyDurableRecordSchemaFamily(outcomeBundle)).toBe("REPUTATION_ENTRY_OUTCOME_V2");
  });

  it("validates the accepted Verified Delivery Receipt V2", () => {
    expect(() => assertVersionedDurableRecordPayload(outcomeReceipt)).not.toThrow();
    expect(identifyDurableRecordSchemaFamily(outcomeReceipt)).toBe("REPUTATION_ENTRY_OUTCOME_V2");
  });

  it("does not interpret Persistence Preflight V1 as Reputation Entry V1", () => {
    expect(() => assertDurableRecordPayloadForSchemaFamily(
      preflightBundle,
      "REPUTATION_ENTRY_V1",
    )).toThrow("DURABLE_RECORD_SCHEMA_FAMILY_MISMATCH");
  });

  it("does not interpret Reputation Entry V1 as Persistence Preflight V1", () => {
    expect(() => assertDurableRecordPayloadForSchemaFamily(
      reputationReceipt,
      "PERSISTENCE_PREFLIGHT_V1",
    )).toThrow("DURABLE_RECORD_SCHEMA_FAMILY_MISMATCH");
  });

  it("does not silently upgrade V1 to V2", () => {
    expect(() => assertVersionedDurableRecordPayload({
      ...reputationBundle,
      recordVersion: 2,
    })).toThrow("DURABLE_RECORD_SCHEMA_FAMILY_VERSION_MISMATCH");
  });

  it("does not silently downcast V2 to V1", () => {
    expect(() => assertVersionedDurableRecordPayload({
      ...outcomeReceipt,
      recordVersion: 1,
    })).toThrow("DURABLE_RECORD_SCHEMA_FAMILY_VERSION_MISMATCH");
  });

  it("fails closed when bundleType labels one family with another family payload", () => {
    const payload = { ...objectPayload(preflightBundle), bundleType: "REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1" };
    expect(() => assertVersionedDurableRecordPayload({ ...preflightBundle, payload })).toThrow(
      "DURABLE_REPUTATION_ENTRY_EVIDENCE_BUNDLE_V1_INVALID",
    );
  });

  it("fails closed on a wrong receiptType", () => {
    const payload = { ...objectPayload(preflightReceipt), receiptType: "VERIFIED_JOB_RECEIPT_V1" };
    expect(() => assertVersionedDurableRecordPayload({ ...preflightReceipt, payload })).toThrow(
      "DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN",
    );
  });

  it("fails closed on an unknown schema family", () => {
    const payload = { ...objectPayload(reputationBundle), bundleType: "UNKNOWN_EVIDENCE_BUNDLE_V1" };
    expect(() => assertVersionedDurableRecordPayload({ ...reputationBundle, payload })).toThrow(
      "DURABLE_EVIDENCE_BUNDLE_SCHEMA_FAMILY_UNKNOWN",
    );
  });

  it("detects family-identifying field tampering", () => {
    const payload = structuredClone(objectPayload(outcomeReceipt));
    const document = payload.document as Record<string, unknown>;
    document.receiptType = "VERIFIED_JOB_RECEIPT_V3";
    expect(() => assertVersionedDurableRecordPayload({ ...outcomeReceipt, payload })).toThrow(
      "DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN",
    );
  });

  it("rejects a valid family payload relabeled as another family", () => {
    const payload = { ...objectPayload(reputationBundle), bundleType: "PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1" };
    expect(() => assertVersionedDurableRecordPayload({ ...reputationBundle, payload })).toThrow(
      "DURABLE_PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1_INVALID",
    );
  });

  it("protects unsupported record versions", () => {
    expect(() => assertVersionedDurableRecordPayload({
      ...outcomeBundle,
      recordVersion: 3,
    })).toThrow("DURABLE_EVIDENCE_BUNDLE_VERSION_UNSUPPORTED");
  });

  it("preserves canonical ordering and hash semantics", () => {
    const reordered = JSON.parse(canonicalJson(objectPayload(reputationBundle))) as Record<string, unknown>;
    expect(sha256Canonical(reordered)).toBe(sha256Canonical(reputationBundle.payload));
    expect(() => assertVersionedDurableRecordPayload({ ...reputationBundle, payload: reordered })).not.toThrow();
  });

  it("rejects competing Receipt discriminators as ambiguous", () => {
    const payload = { ...objectPayload(reputationReceipt), receiptType: "PERSISTENCE_PREFLIGHT_RECEIPT_V1" };
    expect(() => assertVersionedDurableRecordPayload({ ...reputationReceipt, payload })).toThrow(
      "DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_AMBIGUOUS",
    );
  });
});

function familyRecord(record: {
  recordType: string;
  recordVersion: number;
  payload: unknown;
} | null): FamilyRecord {
  if (
    !record ||
    (record.recordType !== "EVIDENCE_BUNDLE_FINAL" && record.recordType !== "VERIFIED_JOB_RECEIPT")
  ) throw new Error("SCHEMA_FAMILY_HISTORICAL_RECORD_MISSING");
  return {
    recordType: record.recordType,
    recordVersion: record.recordVersion,
    payload: record.payload,
  };
}

function objectPayload(record: FamilyRecord): Record<string, unknown> {
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
    throw new Error("SCHEMA_FAMILY_PAYLOAD_INVALID");
  }
  return record.payload as Record<string, unknown>;
}
