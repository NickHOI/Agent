import { sha256Canonical } from "@donelayer/database";

import {
  assertRealJobClassificationRecordIntegrity,
  recordExternalRealJobAuditDecision,
  type ExternalRealJobAuditDecision,
  type RealJobClassificationRecord,
} from "./real-job-classification";

export const REAL_CORPUS_ELIGIBILITY_RULES = "REAL_CORPUS_ELIGIBILITY_RULES_V1" as const;

export type RealCorpusCandidate = {
  classificationRecord: RealJobClassificationRecord;
  auditDecision: ExternalRealJobAuditDecision;
  taskType: string;
  taskTypeBoundInWorkContract: boolean;
  requirementIdentitySha256: string;
  deliveryIdentitySha256: string;
  receiptIntegrityValid: boolean;
  corpusStatus: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  contaminationStatus: "CLEAR" | "QUARANTINED" | "CONFIRMED";
};

export type RealCorpusProjectionEntry = {
  candidateSha256: string;
  jobId: string;
  taskType: string;
  status: "ACTIVE" | "EXCLUDED" | "QUARANTINED" | "IDEMPOTENT_REPLAY";
  canonicalCountContribution: 0 | 1;
  reasons: string[];
};

export type RealCorpusProjection = {
  schemaVersion: 1;
  recordType: "REAL_CORPUS_PROJECTION_V1";
  policy: typeof REAL_CORPUS_ELIGIBILITY_RULES;
  entries: RealCorpusProjectionEntry[];
  canonicalRealVerifiedJobCount: number;
  activeTaskTypes: string[];
  idempotentReplayCount: number;
  quarantinedEntryCount: number;
  projectionSha256: string;
};

export function projectRealCorpus(candidates: RealCorpusCandidate[]): RealCorpusProjection {
  if (!Array.isArray(candidates)) throw new Error("REAL_CORPUS_CANDIDATES_INVALID");

  const candidateHashes = candidates.map((candidate) => {
    assertCandidate(candidate);
    return sha256Canonical(candidate);
  });
  const firstIndexByCandidateHash = new Map<string, number>();
  const entries = candidates.map((candidate, index) => {
    const candidateSha256 = candidateHashes[index]!;
    if (firstIndexByCandidateHash.has(candidateSha256)) {
      return entry(candidate, candidateSha256, "IDEMPOTENT_REPLAY", 0, ["EXACT_CANDIDATE_REPLAY"]);
    }
    firstIndexByCandidateHash.set(candidateSha256, index);
    return evaluateCandidate(candidate, candidateSha256);
  });

  const collisionIndexes = findCollisionIndexes(candidates, entries, firstIndexByCandidateHash);
  for (const index of collisionIndexes) {
    const candidate = candidates[index]!;
    entries[index] = entry(candidate, candidateHashes[index]!, "QUARANTINED", 0, [
      "CONFLICTING_CORPUS_IDENTITY_COLLISION",
    ]);
  }

  const activeEntries = entries.filter((item) => item.status === "ACTIVE");
  const body = {
    schemaVersion: 1 as const,
    recordType: "REAL_CORPUS_PROJECTION_V1" as const,
    policy: REAL_CORPUS_ELIGIBILITY_RULES,
    entries,
    canonicalRealVerifiedJobCount: activeEntries.length,
    activeTaskTypes: [...new Set(activeEntries.map((item) => item.taskType))].sort(),
    idempotentReplayCount: entries.filter((item) => item.status === "IDEMPOTENT_REPLAY").length,
    quarantinedEntryCount: entries.filter((item) => item.status === "QUARANTINED").length,
  };
  return { ...body, projectionSha256: sha256Canonical(body) };
}

export function assertRealCorpusProjectionIntegrity(projection: RealCorpusProjection): void {
  if (!sameKeys(projection, [
    "activeTaskTypes",
    "canonicalRealVerifiedJobCount",
    "entries",
    "idempotentReplayCount",
    "policy",
    "projectionSha256",
    "quarantinedEntryCount",
    "recordType",
    "schemaVersion",
  ])) throw new Error("REAL_CORPUS_PROJECTION_INVALID");
  const { projectionSha256, ...body } = projection;
  const activeEntries = projection.entries.filter((item) => item.status === "ACTIVE");
  const activeTaskTypes = [...new Set(activeEntries.map((item) => item.taskType))].sort();
  if (
    projection.schemaVersion !== 1 ||
    projection.recordType !== "REAL_CORPUS_PROJECTION_V1" ||
    projection.policy !== REAL_CORPUS_ELIGIBILITY_RULES ||
    projectionSha256 !== sha256Canonical(body) ||
    projection.canonicalRealVerifiedJobCount !== activeEntries.length ||
    projection.idempotentReplayCount !== projection.entries.filter(
      (item) => item.status === "IDEMPOTENT_REPLAY",
    ).length ||
    projection.quarantinedEntryCount !== projection.entries.filter(
      (item) => item.status === "QUARANTINED",
    ).length ||
    sha256Canonical(projection.activeTaskTypes) !== sha256Canonical(activeTaskTypes) ||
    projection.entries.some((item) => item.canonicalCountContribution !== (item.status === "ACTIVE" ? 1 : 0))
  ) throw new Error("REAL_CORPUS_PROJECTION_INVALID");
}

function evaluateCandidate(
  candidate: RealCorpusCandidate,
  candidateSha256: string,
): RealCorpusProjectionEntry {
  if (candidate.auditDecision.auditDecision !== "ACCEPT") {
    return entry(candidate, candidateSha256, "EXCLUDED", 0, ["EXTERNAL_AUDIT_NOT_ACCEPTED"]);
  }
  if (!candidate.taskTypeBoundInWorkContract) {
    return entry(candidate, candidateSha256, "EXCLUDED", 0, ["TASK_TYPE_NOT_BOUND_BEFORE_EXECUTION"]);
  }
  if (!candidate.receiptIntegrityValid) {
    return entry(candidate, candidateSha256, "EXCLUDED", 0, ["RECEIPT_INTEGRITY_INVALID"]);
  }
  if (candidate.corpusStatus !== "ACTIVE") {
    return entry(candidate, candidateSha256, "EXCLUDED", 0, [
      candidate.corpusStatus === "REVOKED" ? "CORPUS_ENTRY_REVOKED" : "CORPUS_ENTRY_SUPERSEDED",
    ]);
  }
  if (candidate.contaminationStatus === "QUARANTINED") {
    return entry(candidate, candidateSha256, "QUARANTINED", 0, ["CONTAMINATION_REVIEW_PENDING"]);
  }
  if (candidate.contaminationStatus === "CONFIRMED") {
    return entry(candidate, candidateSha256, "EXCLUDED", 0, ["CONTAMINATION_CONFIRMED"]);
  }
  return entry(candidate, candidateSha256, "ACTIVE", 1, ["ACTIVE_CANONICAL_REAL_VERIFIED_JOB"]);
}

function findCollisionIndexes(
  candidates: RealCorpusCandidate[],
  entries: RealCorpusProjectionEntry[],
  firstIndexByCandidateHash: Map<string, number>,
): Set<number> {
  const indexesByIdentity = new Map<string, number[]>();
  for (const [candidateHash, index] of firstIndexByCandidateHash) {
    if (entries[index]?.status !== "ACTIVE") continue;
    const candidate = candidates[index]!;
    for (const identity of corpusIdentities(candidate)) {
      const indexes = indexesByIdentity.get(identity) ?? [];
      indexes.push(index);
      indexesByIdentity.set(identity, indexes);
    }
    if (candidateHash !== entries[index]?.candidateSha256) {
      throw new Error("REAL_CORPUS_CANDIDATE_IDENTITY_INVALID");
    }
  }
  return new Set(
    [...indexesByIdentity.values()]
      .filter((indexes) => indexes.length > 1)
      .flat(),
  );
}

function corpusIdentities(candidate: RealCorpusCandidate): string[] {
  return [
    `job:${candidate.classificationRecord.input.jobId}`,
    `requirement:${candidate.requirementIdentitySha256}`,
    `contract:${candidate.classificationRecord.input.hashes.workContractSha256}`,
    `evidence:${candidate.classificationRecord.input.hashes.evidenceBundleSha256}`,
    `delivery:${candidate.deliveryIdentitySha256}`,
    `receipt:${candidate.classificationRecord.input.hashes.receiptSha256}`,
  ];
}

function entry(
  candidate: RealCorpusCandidate,
  candidateSha256: string,
  status: RealCorpusProjectionEntry["status"],
  canonicalCountContribution: 0 | 1,
  reasons: string[],
): RealCorpusProjectionEntry {
  return {
    candidateSha256,
    jobId: candidate.classificationRecord.input.jobId,
    taskType: candidate.taskType.trim(),
    status,
    canonicalCountContribution,
    reasons,
  };
}

function assertCandidate(candidate: RealCorpusCandidate): void {
  if (!sameKeys(candidate, [
    "auditDecision",
    "classificationRecord",
    "contaminationStatus",
    "corpusStatus",
    "deliveryIdentitySha256",
    "receiptIntegrityValid",
    "requirementIdentitySha256",
    "taskType",
    "taskTypeBoundInWorkContract",
  ])) throw new Error("REAL_CORPUS_CANDIDATE_INVALID");
  assertRealJobClassificationRecordIntegrity(candidate.classificationRecord);
  const expectedAuditDecision = recordExternalRealJobAuditDecision({
    record: candidate.classificationRecord,
    auditDecision: candidate.auditDecision.auditDecision,
    auditedAt: candidate.auditDecision.auditedAt,
    auditAuthorityReference: candidate.auditDecision.auditAuthorityReference,
  });
  if (sha256Canonical(candidate.auditDecision) !== sha256Canonical(expectedAuditDecision)) {
    throw new Error("REAL_CORPUS_AUDIT_DECISION_INVALID");
  }
  if (!candidate.taskType.trim()) throw new Error("REAL_CORPUS_TASK_TYPE_REQUIRED");
  if (
    typeof candidate.taskTypeBoundInWorkContract !== "boolean" ||
    typeof candidate.receiptIntegrityValid !== "boolean"
  ) throw new Error("REAL_CORPUS_BOOLEAN_INVALID");
  if (!(["ACTIVE", "REVOKED", "SUPERSEDED"] as const).includes(candidate.corpusStatus)) {
    throw new Error("REAL_CORPUS_STATUS_INVALID");
  }
  if (!(["CLEAR", "QUARANTINED", "CONFIRMED"] as const).includes(candidate.contaminationStatus)) {
    throw new Error("REAL_CORPUS_CONTAMINATION_STATUS_INVALID");
  }
  for (const [name, value] of [
    ["REQUIREMENT_IDENTITY", candidate.requirementIdentitySha256],
    ["DELIVERY_IDENTITY", candidate.deliveryIdentitySha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`REAL_CORPUS_${name}_SHA256_INVALID`);
  }
}

function sameKeys(value: object, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}
