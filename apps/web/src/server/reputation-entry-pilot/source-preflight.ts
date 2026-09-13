import { arch, platform, release } from "node:os";

import { sha256Canonical } from "@donelayer/database";
import { REPOSITORY_MATERIALIZATION_REMOTE_URL } from "@donelayer/worker-protocol";

import {
  materializeVerifiedSourcePackage,
  sourceMaterializationFailureEvidence,
  type MaterializedSourcePackage,
  type SourceMaterializationFailureEvidence,
} from "../managed-sandbox/repository-source";
import type { ReputationEntryPilotSource } from "./orchestrator";

export const REPUTATION_ENTRY_SOURCE_PREFLIGHT = "PHASE_B_ATTEMPT_2_SOURCE_MATERIALIZATION_PREFLIGHT_V1" as const;

export type ReputationEntrySourcePreflightResult = {
  taskType: ReputationEntryPilotSource["taskType"];
  repository: string;
  ref: string;
  expectedCommitSha: string;
  resolvedCommitSha: string;
  materializerCommitSha: string;
  repositoryManifestSha256: string;
  sourcePackageSha256: string;
  sourceFileCount: number;
  clone: MaterializedSourcePackage["clone"];
  remoteVerifiedAt: string;
  materializerWorkspaceCleaned: true;
};

export type ReputationEntrySourcePreflightEvidence = {
  preflight: typeof REPUTATION_ENTRY_SOURCE_PREFLIGHT;
  attemptId: string;
  status: "PASS" | "BLOCKED";
  startedAt: string;
  completedAt: string;
  environment: {
    processClass: "NODE_VITEST_INTEGRATION_PROCESS";
    nodeVersion: string;
    os: string;
    architecture: string;
    materializer: "materializeVerifiedSourcePackage";
  };
  repository: string;
  requestedSources: ReputationEntryPilotSource[];
  results: ReputationEntrySourcePreflightResult[];
  checks: {
    exactRepositoryReachable: boolean;
    approvedRefsResolved: boolean;
    exactCommitsMaterialized: boolean;
    temporaryWorkspacesCleaned: boolean;
    remoteMutationPerformed: false;
  };
  failure: (SourceMaterializationFailureEvidence & {
    taskType: ReputationEntryPilotSource["taskType"];
    ref: string;
    expectedCommitSha: string;
  }) | null;
  evidenceSha256: string;
};

type Materializer = typeof materializeVerifiedSourcePackage;

export async function runReputationEntrySourcePreflight(input: {
  attemptId: string;
  sources: ReputationEntryPilotSource[];
  materialize?: Materializer;
  startedAt?: string;
}): Promise<ReputationEntrySourcePreflightEvidence> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const sources = validSources(input.sources);
  const materialize = input.materialize ?? materializeVerifiedSourcePackage;
  const results: ReputationEntrySourcePreflightResult[] = [];
  let failure: ReputationEntrySourcePreflightEvidence["failure"] = null;

  for (const source of sources) {
    try {
      const materialized = await materialize({
        branch: source.branch,
        expectedCommitSha: source.commitSha,
        allowedDeliveryBranch: source.branch,
      });
      results.push({
        taskType: source.taskType,
        repository: materialized.identity.remoteUrl,
        ref: materialized.identity.branch,
        expectedCommitSha: source.commitSha,
        resolvedCommitSha: materialized.independentRemoteCommitSha,
        materializerCommitSha: materialized.materializerCommitSha,
        repositoryManifestSha256: materialized.repositoryManifestSha256,
        sourcePackageSha256: materialized.sourcePackageSha256,
        sourceFileCount: materialized.sourceFileCount,
        clone: materialized.clone,
        remoteVerifiedAt: materialized.remoteVerifiedAt,
        materializerWorkspaceCleaned: materialized.materializerWorkspaceCleaned,
      });
    } catch (error) {
      failure = {
        taskType: source.taskType,
        ref: source.branch,
        expectedCommitSha: source.commitSha,
        ...sourceMaterializationFailureEvidence(error),
      };
      break;
    }
  }

  const passed = failure === null && results.length === sources.length;
  const body = {
    preflight: REPUTATION_ENTRY_SOURCE_PREFLIGHT,
    attemptId: requiredAttemptId(input.attemptId),
    status: passed ? "PASS" as const : "BLOCKED" as const,
    startedAt,
    completedAt: new Date().toISOString(),
    environment: {
      processClass: "NODE_VITEST_INTEGRATION_PROCESS" as const,
      nodeVersion: process.version,
      os: `${platform()} ${release()}`,
      architecture: arch(),
      materializer: "materializeVerifiedSourcePackage" as const,
    },
    repository: REPOSITORY_MATERIALIZATION_REMOTE_URL,
    requestedSources: structuredClone(sources),
    results,
    checks: {
      exactRepositoryReachable: results.length > 0,
      approvedRefsResolved: passed && results.every((result) => result.resolvedCommitSha === result.expectedCommitSha),
      exactCommitsMaterialized: passed && results.every((result) => result.materializerCommitSha === result.expectedCommitSha),
      temporaryWorkspacesCleaned: results.every((result) => result.materializerWorkspaceCleaned) &&
        (failure === null || failure.materializerWorkspaceCleaned === true),
      remoteMutationPerformed: false as const,
    },
    failure,
  };
  return { ...body, evidenceSha256: sha256Canonical(body) };
}

function validSources(sources: ReputationEntryPilotSource[]): [ReputationEntryPilotSource, ReputationEntryPilotSource] {
  if (
    sources.length !== 2 ||
    sources[0]?.taskType !== "TEST_AND_FIX" ||
    sources[1]?.taskType !== "BUILD_RESCUE" ||
    sources.some((source) =>
      !/^donelayer\/repair\/[a-z0-9](?:[a-z0-9-]{0,62})$/.test(source.branch) ||
      !/^[a-f0-9]{40}$/.test(source.commitSha))
  ) throw new Error("REPUTATION_ENTRY_SOURCE_PREFLIGHT_INPUT_INVALID");
  return structuredClone(sources) as [ReputationEntryPilotSource, ReputationEntryPilotSource];
}

function requiredAttemptId(value: string): string {
  if (!/^PHASE_B_ATTEMPT_[1-9][0-9]*$/.test(value)) throw new Error("REPUTATION_ENTRY_ATTEMPT_ID_INVALID");
  return value;
}
