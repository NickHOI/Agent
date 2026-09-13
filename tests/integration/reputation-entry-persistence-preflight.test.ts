import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Canonical } from "@donelayer/database";

import {
  agentIdentityReference,
  createAgentIdentityProfile,
} from "../../apps/web/src/server/agent-identity/agent-identity";
import {
  createAgentExecutionIdentity,
  type AgentExecutionIdentity,
} from "../../apps/web/src/server/agent-identity/execution-identity";
import { ReputationEntryDurableStore } from "../../apps/web/src/server/reputation-entry-pilot/durable-store";
import {
  assertReputationEntryWorkContractIntegrity,
  createReputationEntryWorkContract,
  type ReputationEntryWorkContract,
} from "../../apps/web/src/server/reputation-entry-pilot/work-contract";
import {
  assertTaskScopedPermissionLeaseIntegrity,
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
  TASK_SCOPED_AUTHORITY_ISSUER,
  TaskScopedAuthorityGuard,
  type TaskScopedPermissionLease,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4.sqlite");
const evidencePath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4-evidence.json");
const attempt1DatabasePath = path.join(resultDirectory, "reputation-entry-persistence-preflight.sqlite");
const attempt2DatabasePath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-2.sqlite");
const attempt3DatabasePath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-3.sqlite");
const attempt1ReportPath = path.join(workspaceRoot, "REPUTATION_ENTRY_REPLACEMENT_BATCH_BLOCKED.md");
const attempt2ReportPath = path.join(workspaceRoot, "REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_ATTEMPT_2_BLOCKED.md");
const attempt3ReportPath = path.join(workspaceRoot, "REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_ATTEMPT_3_BLOCKED.md");
const historicalMarkerPath = path.join(resultDirectory, "reputation-entry-pilot-attempt-1-recovered.json");
const persistPreflight = process.env.RUN_REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT === "true";
const existingEvidence = existsSync(databasePath) && existsSync(evidencePath);

const jobId = "job_persistence_preflight_0001";
const executionId = "exe_PERSISTENCE_PREFLIGHT_0001";
const agentId = "agt_PERSISTENCE_PREFLIGHT_0001";

describe("Reputation entry durable persistence preflight", () => {
  it.skipIf(!persistPreflight)("persists before a deliberate failure and recovers exact values after restart", async () => {
    if (!existsSync(historicalMarkerPath)) throw new Error("HISTORICAL_PILOT_MARKER_MISSING");
    if (existsSync(databasePath) || existsSync(evidencePath)) {
      throw new Error("PERSISTENCE_PREFLIGHT_EVIDENCE_ALREADY_EXISTS");
    }
    await mkdir(resultDirectory, { recursive: true });
    const historicalMarkerBefore = digest(readFileSync(historicalMarkerPath));
    const attempt1Before = preservedAttemptIdentity(attempt1DatabasePath, attempt1ReportPath);
    const attempt2Before = preservedAttemptIdentity(attempt2DatabasePath, attempt2ReportPath);
    const attempt3Before = preservedAttemptIdentity(attempt3DatabasePath, attempt3ReportPath);
    const fixtures = createFixtures();
    let deliberateFailureObserved = false;
    const store = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath });
    try {
      store.appendRecord({ recordType: "AGENT_PROFILE", recordId: `${agentId}:1`, payload: fixtures.profile, createdAt: fixtures.profile.createdAt });
      store.appendRecord({
        recordType: "PILOT_OUTCOME",
        recordId: "reputation-entry-persistence-preflight-attempt-4-lineage",
        payload: {
          attempt: 4,
          relationship: "REPLACEMENT_PREFLIGHT_ATTEMPT_NOT_HISTORY_REWRITE",
          newDatabaseFile: path.basename(databasePath),
          attempt1: {
            result: "FAIL_CROSS_HASH_DOMAIN_ASSERTION",
            preserved: attempt1Before,
          },
          attempt2: {
            result: "FAIL_NATIVE_JSON_STRINGIFY_KEY_ORDER_ASSERTION",
            correctedHashSemantics: true,
            preserved: attempt2Before,
          },
          attempt3: {
            result: "FAIL_CONSTRUCTOR_SQLITE_HANDLE_LEAK_ON_WINDOWS",
            canonicalStructuralComparisonAndTamperTestsPassed: true,
            preserved: attempt3Before,
          },
          attempt4: { change: "CONSTRUCTOR_FAILURE_CLOSES_OPEN_SQLITE_RESOURCE" },
          historicalMarkerSha256: historicalMarkerBefore,
        },
        createdAt: "2026-09-04T00:00:00.500Z",
      });
      store.appendRecord({ jobId, recordType: "JOB_IDENTITY", recordId: jobId, payload: { jobId, taskType: "TEST_AND_FIX", candidateStatus: "REPUTATION_ENTRY_CANDIDATE" }, createdAt: "2026-09-04T00:00:01.000Z" });
      store.appendRecord({ jobId, recordType: "AGENT_PROFILE_BINDING", recordId: `${jobId}:${agentId}:1`, payload: agentIdentityReference(fixtures.profile), createdAt: "2026-09-04T00:00:02.000Z" });
      store.appendRecord({ jobId, recordType: "SOURCE_IDENTITY", recordId: `${jobId}:source`, payload: fixtures.contract.sourceIdentity, createdAt: "2026-09-04T00:00:03.000Z" });
      store.appendRecord({ jobId, recordType: "WORK_CONTRACT", recordId: fixtures.contract.taskId, payload: fixtures.contract, createdAt: fixtures.contract.lockedAt });
      store.appendRecord({ jobId, recordType: "AUTHORITY_LEASE_ISSUED", recordId: fixtures.lease.id, payload: fixtures.lease, createdAt: fixtures.lease.startsAt });
      store.appendRecord({ jobId, recordType: "EXECUTION_IDENTITY", recordId: executionId, payload: fixtures.execution, createdAt: fixtures.execution.startedAt });
      store.appendRecord({
        jobId,
        recordType: "EVIDENCE_BUNDLE_INTERMEDIATE",
        recordId: `${jobId}:authorized`,
        payload: {
          stage: "AUTHORIZED",
          jobId,
          executionId,
          workContractSha256: fixtures.contract.workContractSha256,
          authoritySha256: fixtures.lease.authoritySha256,
          profileSha256: fixtures.profile.profileSha256,
        },
        createdAt: "2026-09-04T00:00:08.000Z",
      });
      store.appendRecord({
        jobId,
        recordType: "VERIFIER_RESULT",
        recordId: `${jobId}:verifier`,
        payload: { result: "FAILED_PREFLIGHT_FIXTURE", sandboxCreated: false, command: "deterministic-local-preflight", exitCode: 1 },
        createdAt: "2026-09-04T00:00:09.000Z",
      });
      store.appendRecord({ jobId, recordType: "AUTHORITY_LEASE_REVOKED", recordId: fixtures.revokedLease.id, recordVersion: 2, payload: fixtures.revokedLease, createdAt: fixtures.revokedLease.revokedAt! });
      const finalBundle = {
        bundleType: "PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1",
        jobId,
        result: "FAILED",
        intermediateRecovered: true,
        verifierResultPersisted: true,
        leaseStatus: fixtures.revokedLease.status,
      };
      store.appendRecord({ jobId, recordType: "EVIDENCE_BUNDLE_FINAL", recordId: `${jobId}:bundle`, payload: finalBundle, createdAt: "2026-09-04T00:00:11.000Z" });
      const lifecycleBeforeReceipt = store.recoverJob(jobId);
      store.appendRecord({
        jobId,
        recordType: "EVIDENCE_LEDGER_FINAL",
        recordId: `${jobId}:ledger`,
        payload: { entryCount: lifecycleBeforeReceipt.lifecycle.length, chainSha256: lifecycleBeforeReceipt.lifecycleChainSha256 },
        createdAt: "2026-09-04T00:00:12.000Z",
      });
      const receiptBody = {
        receiptType: "PERSISTENCE_PREFLIGHT_RECEIPT_V1",
        jobId,
        executionId,
        workContractSha256: fixtures.contract.workContractSha256,
        authoritySha256: fixtures.revokedLease.authoritySha256,
        bundleSha256: sha256Canonical(finalBundle),
        result: "FAILED",
        candidateCounted: false,
      };
      store.appendRecord({
        jobId,
        recordType: "VERIFIED_JOB_RECEIPT",
        recordId: `${jobId}:receipt`,
        payload: { ...receiptBody, receiptSha256: sha256Canonical(receiptBody) },
        createdAt: "2026-09-04T00:00:13.000Z",
      });
      throw new Error("DELIBERATE_POST_PERSISTENCE_FAILURE");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("DELIBERATE_POST_PERSISTENCE_FAILURE");
      deliberateFailureObserved = true;
    } finally {
      store.close();
    }

    expect(deliberateFailureObserved).toBe(true);
    const reopened = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath });
    try {
      const recovered = reopened.recoverJob(jobId);
      const verification = reopened.verifyAll();
      expect(recovered.integrityValid).toBe(true);
      expect(verification.valid).toBe(true);
      expect(recovered.recordTypes).toEqual([
        "JOB_IDENTITY",
        "AGENT_PROFILE_BINDING",
        "SOURCE_IDENTITY",
        "WORK_CONTRACT",
        "AUTHORITY_LEASE_ISSUED",
        "EXECUTION_IDENTITY",
        "EVIDENCE_BUNDLE_INTERMEDIATE",
        "VERIFIER_RESULT",
        "AUTHORITY_LEASE_REVOKED",
        "EVIDENCE_BUNDLE_FINAL",
        "EVIDENCE_LEDGER_FINAL",
        "VERIFIED_JOB_RECEIPT",
      ]);
      const persistedExecution = record(reopened, "EXECUTION_IDENTITY", executionId);
      const persistedContract = record(reopened, "WORK_CONTRACT", fixtures.contract.taskId);
      const reloadedContract = persistedContract.payload as ReputationEntryWorkContract;
      const { workContractSha256: reloadedCanonicalHash, ...reloadedContractBody } = reloadedContract;
      const fullContractCanonicalJson = canonicalJson(reloadedContract);
      const contractBodyCanonicalJson = canonicalJson(reloadedContractBody);

      expect(persistedExecution.payloadSha256).toBe(sha256Canonical(fixtures.execution));
      expect(persistedContract.payloadSha256).toBe(sha256Canonical(reloadedContract));
      expect(persistedContract.payloadSha256).toBe(sha256Canonical(fixtures.contract));
      expect(reloadedCanonicalHash).toBe(sha256Canonical(reloadedContractBody));
      expect(reloadedCanonicalHash).toBe(fixtures.contract.workContractSha256);
      expect(persistedContract.payloadSha256).not.toBe(reloadedCanonicalHash);
      expect(() => assertReputationEntryWorkContractIntegrity(reloadedContract)).not.toThrow();
      expect(fixtures.lease.authority.workContract.sha256).toBe(reloadedCanonicalHash);
      expect(fixtures.execution.workContract.sha256).toBe(reloadedCanonicalHash);
      expect(record(reopened, "AUTHORITY_LEASE_REVOKED", fixtures.revokedLease.id, 2).payload).toMatchObject({ status: "REVOKED" });

      const coveredFieldTampering = structuredClone(reloadedContract);
      coveredFieldTampering.desiredOutcome = "tampered covered field";
      expect(sha256Canonical(coveredFieldTampering)).not.toBe(persistedContract.payloadSha256);
      expect(() => assertReputationEntryWorkContractIntegrity(coveredFieldTampering)).toThrow(/TAMPERING/);

      const commandTampering = structuredClone(reloadedContract);
      commandTampering.acceptanceCriteria.commands[0]!.command = "npm run build";
      expect(() => assertReputationEntryWorkContractIntegrity(commandTampering)).toThrow(/TAMPERING/);

      const commandArgumentTampering = structuredClone(reloadedContract) as unknown as {
        acceptanceCriteria: { commands: Array<Record<string, unknown>> };
      };
      commandArgumentTampering.acceptanceCriteria.commands[0]!.args = ["--silent"];
      expect(() => assertReputationEntryWorkContractIntegrity(
        commandArgumentTampering as unknown as ReputationEntryWorkContract,
      )).toThrow(/TAMPERING/);

      const sourceIdentityTampering = structuredClone(reloadedContract);
      sourceIdentityTampering.sourceIdentity.manifestSha256 = "e".repeat(64);
      expect(() => assertReputationEntryWorkContractIntegrity(sourceIdentityTampering)).toThrow(/TAMPERING/);

      const selfHashFieldTampering = structuredClone(reloadedContract);
      selfHashFieldTampering.workContractSha256 = "f".repeat(64);
      const { workContractSha256: _tamperedSelfHash, ...selfHashExcludedBody } = selfHashFieldTampering;
      expect(sha256Canonical(selfHashExcludedBody)).toBe(reloadedCanonicalHash);
      expect(sha256Canonical(selfHashFieldTampering)).not.toBe(persistedContract.payloadSha256);
      expect(() => assertReputationEntryWorkContractIntegrity(selfHashFieldTampering)).toThrow(/TAMPERING/);

      const persistedLease = record(reopened, "AUTHORITY_LEASE_ISSUED", fixtures.lease.id).payload as TaskScopedPermissionLease;
      expect(() => assertTaskScopedPermissionLeaseIntegrity(persistedLease)).not.toThrow();
      const authorityBindingTampering = structuredClone(persistedLease);
      authorityBindingTampering.authority.workContract.sha256 = "d".repeat(64);
      authorityBindingTampering.authoritySha256 = preflightAuthoritySha256(authorityBindingTampering);
      expect(() => assertTaskScopedPermissionLeaseIntegrity(authorityBindingTampering)).not.toThrow();
      expect(() => new TaskScopedAuthorityGuard(authorityBindingTampering, {
        contract: reloadedContract,
        subject: authorityBindingTampering.authority.subject,
      })).toThrow(/BINDING_MISMATCH/);

      const persistedBundleRecord = record(reopened, "EVIDENCE_BUNDLE_FINAL", `${jobId}:bundle`);
      const persistedBundle = persistedBundleRecord.payload as PreflightBundle;
      const persistedReceipt = record(reopened, "VERIFIED_JOB_RECEIPT", `${jobId}:receipt`).payload as PreflightReceipt;
      expect(persistedBundleRecord.payloadSha256).toBe(sha256Canonical(persistedBundle));
      expect(persistedReceipt.workContractSha256).toBe(reloadedCanonicalHash);
      expect(() => assertPreflightReceiptBindings(persistedReceipt, {
        contractSha256: reloadedCanonicalHash,
        authoritySha256: fixtures.revokedLease.authoritySha256,
        bundle: persistedBundle,
      })).not.toThrow();

      const bundleContentTampering = structuredClone(persistedBundle);
      bundleContentTampering.result = "INCONCLUSIVE";
      expect(sha256Canonical(bundleContentTampering)).not.toBe(persistedBundleRecord.payloadSha256);
      expect(() => assertPreflightReceiptBindings(persistedReceipt, {
        contractSha256: reloadedCanonicalHash,
        authoritySha256: fixtures.revokedLease.authoritySha256,
        bundle: bundleContentTampering,
      })).toThrow(/BINDING_MISMATCH/);

      const receiptBindingTampering = structuredClone(persistedReceipt);
      receiptBindingTampering.workContractSha256 = "c".repeat(64);
      receiptBindingTampering.receiptSha256 = preflightReceiptSha256(receiptBindingTampering);
      expect(() => assertPreflightReceiptBindings(receiptBindingTampering, {
        contractSha256: reloadedCanonicalHash,
        authoritySha256: fixtures.revokedLease.authoritySha256,
        bundle: persistedBundle,
      })).toThrow(/BINDING_MISMATCH/);

      expect(() => reopened.appendRecord({
        jobId,
        recordType: "WORK_CONTRACT",
        recordId: fixtures.contract.taskId,
        payload: { ...fixtures.contract, desiredOutcome: "tampered" },
      })).toThrow(/OVERWRITE_DENIED/);

      const markerIsolation = await proveMarkerTamperDetectionAndCleanup();
      expect(digest(readFileSync(historicalMarkerPath))).toBe(historicalMarkerBefore);
      expect(preservedAttemptIdentity(attempt1DatabasePath, attempt1ReportPath)).toEqual(attempt1Before);
      expect(preservedAttemptIdentity(attempt2DatabasePath, attempt2ReportPath)).toEqual(attempt2Before);
      expect(preservedAttemptIdentity(attempt3DatabasePath, attempt3ReportPath)).toEqual(attempt3Before);
      reopened.close();
      expect(() => reopened.close()).not.toThrow();
      const evidence = {
        gate: "REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_V1",
        attempt: 4,
        result: "PASS",
        deliberateFailureObserved,
        historicalMarkerSha256: historicalMarkerBefore,
        historicalMarkerUnchanged: true,
        markerTamperDetection: markerIsolation.result,
        failedInitializationCleanup: markerIsolation,
        successfulStoreClose: {
          closedWithoutError: true,
          repeatedCloseSafe: true,
          database: fileIdentity(databasePath),
        },
        lineage: {
          relationship: "REPLACEMENT_PREFLIGHT_ATTEMPT_NOT_HISTORY_REWRITE",
          newDatabaseFile: path.basename(databasePath),
          attempt1: {
            result: "FAIL_CROSS_HASH_DOMAIN_ASSERTION",
            preserved: attempt1Before,
          },
          attempt2: {
            result: "FAIL_NATIVE_JSON_STRINGIFY_KEY_ORDER_ASSERTION",
            correctedHashSemantics: true,
            preserved: attempt2Before,
          },
          attempt3: {
            result: "FAIL_CONSTRUCTOR_SQLITE_HANDLE_LEAK_ON_WINDOWS",
            canonicalStructuralComparisonAndTamperTestsPassed: true,
            preserved: attempt3Before,
          },
          attempt4: { change: "CONSTRUCTOR_FAILURE_CLOSES_OPEN_SQLITE_RESOURCE" },
        },
        hashDomains: {
          persistedFullPayload: {
            definition: "SHA-256 over UTF-8 bytes of canonicalJson(complete Work Contract document)",
            includedFields: Object.keys(reloadedContract).sort(),
            excludedFields: [],
            canonicalJson: fullContractCanonicalJson,
            canonicalUtf8ByteLength: Buffer.byteLength(fullContractCanonicalJson, "utf8"),
            sha256: persistedContract.payloadSha256,
          },
          canonicalWorkContract: {
            definition: "SHA-256 over UTF-8 bytes of canonicalJson(Work Contract body after removing workContractSha256)",
            includedFields: Object.keys(reloadedContractBody).sort(),
            excludedFields: ["workContractSha256"],
            canonicalJson: contractBodyCanonicalJson,
            canonicalUtf8ByteLength: Buffer.byteLength(contractBodyCanonicalJson, "utf8"),
            sha256: reloadedCanonicalHash,
          },
          selfReferenceReason: "Including workContractSha256 in its own digest would require the digest to be known before the bytes that determine it are finalized.",
          bindings: {
            authorityWorkContractSha256: fixtures.lease.authority.workContract.sha256,
            executionWorkContractSha256: fixtures.execution.workContract.sha256,
            receiptWorkContractSha256: persistedReceipt.workContractSha256,
          },
        },
        negativeTests: {
          coveredFieldTamperingDetected: true,
          commandTamperingDetected: true,
          commandArgumentTamperingDetected: true,
          sourceIdentityTamperingDetected: true,
          authorityBindingTamperingDetected: true,
          evidenceBundleContentTamperingDetected: true,
          receiptBindingTamperingDetected: true,
          canonicalKeyOrderNormalizationAccepted: true,
          selfHashFieldTamperingDetected: true,
          selfHashExcludedDomainRemainedStable: true,
          immutableRecordOverwriteDenied: true,
        },
        exactRecovered: {
          agentId,
          profileRevision: fixtures.profile.revision,
          profileSha256: fixtures.profile.profileSha256,
          jobId,
          executionId,
          executionSha256: fixtures.execution.executionSha256,
          workContractId: fixtures.contract.taskId,
          workContractVersion: fixtures.contract.contractVersion,
          workContractSha256: fixtures.contract.workContractSha256,
          permissionLeaseId: fixtures.revokedLease.id,
          permissionLeaseStatus: fixtures.revokedLease.status,
          authoritySha256: fixtures.revokedLease.authoritySha256,
          recordCount: recovered.records.length,
          lifecycleEntryCount: recovered.lifecycle.length,
          lifecycleChainSha256: recovered.lifecycleChainSha256,
        },
        storeVerification: verification,
      };
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    } finally {
      reopened.close();
    }
  });

  it.skipIf(!persistPreflight && !existingEvidence)("reloads the retained preflight evidence without changing identifiers", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    expect(evidence).toMatchObject({
      gate: "REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_V1",
      attempt: 4,
      result: "PASS",
      deliberateFailureObserved: true,
      historicalMarkerUnchanged: true,
      markerTamperDetection: "DETECTED_WITHOUT_TOUCHING_HISTORICAL_MARKER",
    });
    const store = new ReputationEntryDurableStore(databasePath, {
      historicalMarkerPath,
      readOnly: true,
    });
    try {
      expect(store.verifyAll().valid).toBe(true);
      const recovered = store.recoverJob(jobId);
      expect(recovered.integrityValid).toBe(true);
      const exact = evidence.exactRecovered as Record<string, unknown>;
      const persistedExecution = record(store, "EXECUTION_IDENTITY", executionId);
      const persistedContract = record(store, "WORK_CONTRACT", String(exact.workContractId));
      const execution = persistedExecution.payload as AgentExecutionIdentity;
      const contract = persistedContract.payload as ReputationEntryWorkContract;
      const { workContractSha256, ...body } = contract;
      expect(execution.executionSha256).toBe(exact.executionSha256);
      expect(persistedExecution.payloadSha256).toBe(sha256Canonical(execution));
      expect(persistedContract.payloadSha256).toBe(sha256Canonical(contract));
      expect(workContractSha256).toBe(sha256Canonical(body));
      expect(workContractSha256).toBe(exact.workContractSha256);
      expect(persistedContract.payloadSha256).not.toBe(workContractSha256);
      expect(() => assertReputationEntryWorkContractIntegrity(contract)).not.toThrow();
      expect(record(store, "AUTHORITY_LEASE_REVOKED", String(exact.permissionLeaseId), 2).payload).toMatchObject({ status: "REVOKED" });
    } finally {
      store.close();
    }
  });
});

function createFixtures() {
  const profile = createAgentIdentityProfile({
    agentId,
    displayName: "Persistence Preflight Agent",
    controller: {
      controllerType: "PLATFORM_ACCOUNT",
      accountType: "USER",
      accountId: "owner-persistence-preflight",
      relationship: "CONTROLS",
      assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
      legallyVerified: false,
    },
    declaredCapabilities: ["TEST_AND_FIX"],
    createdAt: "2026-09-04T00:00:00.000Z",
  });
  const files = [
    { relative_path: "src/parse-port.ts", sha256: "1".repeat(64) },
    { relative_path: "tests/parse-port.test.ts", sha256: "2".repeat(64) },
  ];
  const contract = createReputationEntryWorkContract({
    taskId: "contract_persistence_preflight_0001",
    taskType: "TEST_AND_FIX",
    assignedAgent: agentIdentityReference(profile),
    taskDefinitionVersion: 1,
    source: {
      branch: "donelayer/repair/persistence-preflight-only",
      commitSha: "3".repeat(40),
      manifestSha256: sha256Canonical(files),
      files,
    },
    lockedAt: "2026-09-04T00:00:04.000Z",
  });
  const decision = decideTaskScopedAuthority({
    contract,
    subject: {
      agentId,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      jobRunId: jobId,
      agentIdentity: agentIdentityReference(profile),
      executionId,
    },
    decidedAt: "2026-09-04T00:00:05.000Z",
    durationSeconds: 300,
  });
  const lease = issueTaskScopedPermissionLease(decision);
  const execution = createAgentExecutionIdentity({
    executionId,
    profile,
    contract,
    authorityLease: lease,
    executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
    runtime: { provider: "LOCAL_DETERMINISTIC_PREFLIGHT", modelId: null, sandboxProvider: null },
    startedAt: "2026-09-04T00:00:06.000Z",
  });
  const revokedLease = revokeTaskScopedPermissionLease({
    lease,
    revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
    reason: "Deterministic persistence preflight concluded",
    revokedAt: "2026-09-04T00:00:10.000Z",
  });
  return { profile, contract, lease, execution, revokedLease };
}

function record(store: ReputationEntryDurableStore, type: Parameters<ReputationEntryDurableStore["getRecord"]>[0], id: string, version = 1) {
  const found = store.getRecord(type, id, version);
  if (!found) throw new Error(`Missing durable record ${type}:${id}:${version}`);
  return found;
}

async function proveMarkerTamperDetectionAndCleanup() {
  const root = await mkdtemp(path.join(tmpdir(), "donelayer-marker-proof-"));
  const markerCopy = path.join(root, "historical-marker.json");
  const databaseCopy = path.join(root, "marker-proof.sqlite");
  const walPath = `${databaseCopy}-wal`;
  const shmPath = `${databaseCopy}-shm`;
  let proofComplete = false;
  try {
    await writeFile(markerCopy, readFileSync(historicalMarkerPath));
    const initialStore = new ReputationEntryDurableStore(databaseCopy, { historicalMarkerPath: markerCopy });
    const sidecarsObservedWhileOpen = {
      wal: existsSync(walPath),
      shm: existsSync(shmPath),
    };
    initialStore.close();
    expect(() => initialStore.close()).not.toThrow();
    await writeFile(markerCopy, "{\"tampered\":true}\n", "utf8");
    let constructorFailure: unknown;
    try {
      new ReputationEntryDurableStore(databaseCopy, { historicalMarkerPath: markerCopy });
    } catch (error) {
      constructorFailure = error;
    }
    expect(constructorFailure).toBeInstanceOf(Error);
    expect((constructorFailure as Error).message).toBe("HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH");

    const filesAfterFailedInitialization = {
      database: existsSync(databaseCopy),
      wal: existsSync(walPath),
      shm: existsSync(shmPath),
    };
    const immediateDeletion = {
      wal: await removeIfPresent(walPath),
      shm: await removeIfPresent(shmPath),
      database: await removeIfPresent(databaseCopy),
    };
    await rm(markerCopy);
    await rm(root, { recursive: true });
    expect(existsSync(root)).toBe(false);
    proofComplete = true;
    return {
      result: "DETECTED_WITHOUT_TOUCHING_HISTORICAL_MARKER",
      platform: process.platform,
      runningOnWindows: process.platform === "win32",
      failureInjectedAfterSQLiteOpen: true,
      constructorFailureMessage: (constructorFailure as Error).message,
      originalFailurePreserved: true,
      sidecarsObservedWhileInitialStoreOpen: sidecarsObservedWhileOpen,
      filesAfterFailedInitialization,
      immediateDeletion,
      containingTemporaryDirectoryRemoved: true,
      arbitraryWaitsOrRetries: 0,
    };
  } finally {
    if (!proofComplete) await rm(root, { recursive: true, force: true });
  }
}

type PreflightBundle = {
  bundleType: string;
  jobId: string;
  result: string;
  intermediateRecovered: boolean;
  verifierResultPersisted: boolean;
  leaseStatus: string;
};

type PreflightReceipt = {
  receiptType: string;
  jobId: string;
  executionId: string;
  workContractSha256: string;
  authoritySha256: string;
  bundleSha256: string;
  result: string;
  candidateCounted: boolean;
  receiptSha256: string;
};

function preflightAuthoritySha256(lease: TaskScopedPermissionLease): string {
  return sha256Canonical({
    id: lease.id,
    version: lease.version,
    startsAt: lease.startsAt,
    expiresAt: lease.expiresAt,
    scope: lease.scope,
    authorityType: lease.authorityType,
    authority: lease.authority,
  });
}

function preflightReceiptSha256(receipt: PreflightReceipt): string {
  const { receiptSha256: _receiptSha256, ...body } = receipt;
  return sha256Canonical(body);
}

function assertPreflightReceiptBindings(
  receipt: PreflightReceipt,
  expected: { contractSha256: string; authoritySha256: string; bundle: PreflightBundle },
): void {
  if (
    preflightReceiptSha256(receipt) !== receipt.receiptSha256 ||
    receipt.workContractSha256 !== expected.contractSha256 ||
    receipt.authoritySha256 !== expected.authoritySha256 ||
    receipt.bundleSha256 !== sha256Canonical(expected.bundle)
  ) throw new Error("PREFLIGHT_RECEIPT_BINDING_MISMATCH");
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileIdentity(filePath: string): { fileName: string; size: number; sha256: string } {
  const bytes = readFileSync(filePath);
  return { fileName: path.basename(filePath), size: bytes.byteLength, sha256: digest(bytes) };
}

function optionalFileIdentity(filePath: string): ReturnType<typeof fileIdentity> | null {
  return existsSync(filePath) ? fileIdentity(filePath) : null;
}

function preservedAttemptIdentity(databaseFilePath: string, reportPath: string) {
  return {
    database: fileIdentity(databaseFilePath),
    wal: optionalFileIdentity(`${databaseFilePath}-wal`),
    shm: optionalFileIdentity(`${databaseFilePath}-shm`),
    report: fileIdentity(reportPath),
  };
}

async function removeIfPresent(filePath: string): Promise<{ existed: boolean; removed: boolean }> {
  const existed = existsSync(filePath);
  if (existed) await rm(filePath);
  return { existed, removed: !existsSync(filePath) };
}
