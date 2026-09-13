import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson, sha256Canonical } from "@donelayer/database";
import { describe, expect, it } from "vitest";

import {
  ReputationEntryDurableStore,
  assertDurableRecordIntegrity,
  type DurableRecord,
} from "../../apps/web/src/server/reputation-entry-pilot/durable-store";
import {
  agentModelRunV1Schema,
  agentModelRunV2Schema,
} from "../../apps/web/src/server/reputation-entry-pilot/durable-record-versions";

describe("version-aware AGENT_MODEL_RUN lifecycle verification", () => {
  it("verifies a valid V1 AGENT_MODEL_RUN record", () => {
    expect(() => assertDurableRecordIntegrity(record(1, v1Payload()))).not.toThrow();
    expect(agentModelRunV1Schema.safeParse(v1Payload()).success).toBe(true);
  });

  it("verifies a valid V2 AGENT_MODEL_RUN record", () => {
    expect(() => assertDurableRecordIntegrity(record(2, v2Payload()))).not.toThrow();
    expect(agentModelRunV2Schema.safeParse(v2Payload()).success).toBe(true);
  });

  it("keeps V1 as V1 after persistence and read-only reload", async () => {
    await withFixture(async ({ databasePath, markerPath }) => {
      const writer = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath });
      writer.appendRecord({ jobId: "job_v1", recordType: "AGENT_MODEL_RUN", recordId: "job_v1:model-run", recordVersion: 1, payload: v1Payload() });
      writer.close();

      const reader = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath, readOnly: true });
      try {
        const reloaded = reader.getRecord("AGENT_MODEL_RUN", "job_v1:model-run", 1)!;
        expect(reloaded.recordVersion).toBe(1);
        expect(reloaded.payload).toEqual(v1Payload());
        expect(reader.verifyAll()).toMatchObject({ valid: true, jobCount: 1, lifecycleEntryCount: 1 });
      } finally {
        reader.close();
      }
    });
  });

  it("keeps V2 as V2 after persistence and read-only reload", async () => {
    await withFixture(async ({ databasePath, markerPath }) => {
      const writer = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath });
      writer.appendRecord({ jobId: "job_v2", recordType: "AGENT_MODEL_RUN", recordId: "job_v2:model-run", recordVersion: 2, payload: v2Payload() });
      writer.close();

      const reader = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath, readOnly: true });
      try {
        const reloaded = reader.getRecord("AGENT_MODEL_RUN", "job_v2:model-run", 2)!;
        expect(reloaded.recordVersion).toBe(2);
        expect(reloaded.payload).toEqual(v2Payload());
        expect(reader.verifyAll()).toMatchObject({ valid: true, jobCount: 1, lifecycleEntryCount: 1 });
      } finally {
        reader.close();
      }
    });
  });

  it("fails when record_version is dropped", () => {
    const missingVersion = record(1, v1Payload()) as Partial<DurableRecord>;
    delete missingVersion.recordVersion;
    expect(() => assertDurableRecordIntegrity(missingVersion as DurableRecord)).toThrow("DURABLE_RECORD_VERSION_INVALID");
  });

  it("fails when a V1 body is relabeled as V2", () => {
    expect(() => assertDurableRecordIntegrity(record(2, v1Payload()))).toThrow("DURABLE_AGENT_MODEL_RUN_V2_INVALID");
  });

  it("fails when a V2 body is relabeled as V1", () => {
    expect(() => assertDurableRecordIntegrity(record(1, v2Payload()))).toThrow("DURABLE_AGENT_MODEL_RUN_V1_INVALID");
  });

  it("fails when a version-covered field changes without its historical hash", () => {
    const original = record(1, v1Payload());
    const changed = structuredClone(original);
    (changed.payload as ReturnType<typeof v1Payload>).maxSteps = 7;
    expect(() => assertDurableRecordIntegrity(changed)).toThrow("DURABLE_RECORD_PAYLOAD_HASH_MISMATCH");
  });

  it("fails closed for an unknown AGENT_MODEL_RUN version", () => {
    expect(() => assertDurableRecordIntegrity(record(3, v2Payload()))).toThrow("DURABLE_AGENT_MODEL_RUN_VERSION_UNSUPPORTED");
  });

  it("preserves canonical object equivalence and ordered-array semantics", () => {
    const payload = v2Payload();
    const sameObjectDifferentInsertionOrder = {
      finishedAt: payload.finishedAt,
      startedAt: payload.startedAt,
      usage: payload.usage,
      responseIds: payload.responseIds,
      toolNames: payload.toolNames,
      stepCount: payload.stepCount,
      finishReason: payload.finishReason,
      text: payload.text,
      model: payload.model,
      status: payload.status,
      runId: payload.runId,
    };
    expect(canonicalJson(sameObjectDifferentInsertionOrder)).toBe(canonicalJson(payload));
    expect(sha256Canonical({ ...payload, responseIds: [...payload.responseIds].reverse() })).not.toBe(sha256Canonical(payload));
  });

  it("never reinterprets a historical V1 body through the V2 schema", () => {
    expect(agentModelRunV1Schema.safeParse(v1Payload()).success).toBe(true);
    expect(agentModelRunV2Schema.safeParse(v1Payload()).success).toBe(false);
  });

  it("never downcasts a V2 body through the V1 schema", () => {
    expect(agentModelRunV2Schema.safeParse(v2Payload()).success).toBe(true);
    expect(agentModelRunV1Schema.safeParse(v2Payload()).success).toBe(false);
  });

  it("binds V1 and V2 with the same record identity to their exact payload hashes", async () => {
    await withFixture(async ({ databasePath, markerPath }) => {
      const store = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath });
      try {
        store.appendRecord({ jobId: "job_both", recordType: "AGENT_MODEL_RUN", recordId: "job_both:model-run", recordVersion: 1, payload: v1Payload(), createdAt: "2026-09-04T15:00:00.000Z" });
        store.appendRecord({ jobId: "job_both", recordType: "AGENT_MODEL_RUN", recordId: "job_both:model-run", recordVersion: 2, payload: v2Payload(), createdAt: "2026-09-04T15:01:00.000Z" });
        expect(store.verifyAll()).toMatchObject({ valid: true, jobCount: 1, lifecycleEntryCount: 2 });
        expect(store.recoverJob("job_both")).toMatchObject({ integrityValid: true, recordTypes: ["AGENT_MODEL_RUN", "AGENT_MODEL_RUN"] });
      } finally {
        store.close();
      }
    });
  });

  it("keeps read-only verification byte-identical and denies append", async () => {
    await withFixture(async ({ databasePath, markerPath }) => {
      const writer = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath });
      writer.appendRecord({ jobId: "job_read_only", recordType: "AGENT_MODEL_RUN", recordId: "job_read_only:model-run", recordVersion: 1, payload: v1Payload() });
      writer.close();
      const before = readFileSync(databasePath);

      const reader = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath, readOnly: true });
      try {
        expect(reader.verifyAll().valid).toBe(true);
        expect(() => reader.appendRecord({ recordType: "PILOT_OUTCOME", recordId: "forbidden", payload: {} })).toThrow("REPUTATION_ENTRY_DURABLE_STORE_READ_ONLY");
      } finally {
        reader.close();
      }
      expect(readFileSync(databasePath)).toEqual(before);
    });
  });
});

function record(recordVersion: number, payload: unknown): DurableRecord {
  return {
    id: "record_id",
    jobId: "job_id",
    recordType: "AGENT_MODEL_RUN",
    recordId: "job_id:model-run",
    recordVersion,
    payloadSha256: sha256Canonical(payload),
    payload,
    createdAt: "2026-09-04T15:00:00.000Z",
  };
}

function model() {
  return {
    id: "provider/model-free",
    name: "Model Free",
    provider: "provider",
    type: "language" as const,
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    pricing: { input: "0", output: "0", cachedInputTokens: null },
    supportsReasoning: true,
    supportsTools: true,
    isFree: true,
  };
}

function v1Payload() {
  return {
    status: "REQUESTED" as const,
    model: model(),
    maxSteps: 8,
    maxOutputTokens: 4_096,
    providerRetryLimit: 1 as const,
  };
}

function v2Payload() {
  return {
    runId: "run_v2",
    status: "FAILED" as const,
    model: model(),
    text: "",
    finishReason: "MODEL_REQUEST_FAILED",
    stepCount: 0,
    toolNames: ["list_files", "read_file"] as const,
    responseIds: ["response-1", "response-2"],
    usage: {
      apiRequestCount: 2,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      gatewayReportedCostUsd: null,
    },
    startedAt: "2026-09-04T15:00:00.000Z",
    finishedAt: "2026-09-04T15:00:01.000Z",
  };
}

async function withFixture(run: (fixture: { root: string; databasePath: string; markerPath: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "donelayer-lifecycle-versioning-"));
  const databasePath = path.join(root, "durable.sqlite");
  const markerPath = path.join(root, "historical-marker.json");
  await writeFile(markerPath, "historical marker\n", "utf8");
  try {
    await run({ root, databasePath, markerPath });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
