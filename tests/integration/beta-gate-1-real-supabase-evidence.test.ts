import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type MigrationEvidence = {
  name: string;
  remoteVersion: string;
  path: string;
  sha256: string;
};

type GateEvidence = {
  gate: string;
  status: string;
  project: {
    name: string;
    projectId: string;
    purpose: string;
    status: string;
    unrelatedGymProjectAccessedOrModified: boolean;
  };
  historicalPrerequisiteRootCause: {
    originalFailure: string;
    historicalMigrationModified: boolean;
    blockedEvidencePreserved: boolean;
  };
  migrations: MigrationEvidence[];
  schemaValidation: {
    constraintsIndexesTriggersRlsAndGrantsCatalogVerified: boolean;
    semanticReviewRlsEnabled: boolean;
    semanticReviewClientPolicyCount: number;
    semanticMutationFunctionSearchPath: string;
    semanticMutationFunctionClientExecute: boolean;
    semanticMutationFunctionServiceExecute: boolean;
    schemaConflictsOrDuplicates: number;
  };
  authenticationAndRls: {
    owner: { identityRowsVisibleAtProbe: number; unrelatedProfileRowsVisible: number };
    unrelated: { identityRowsVisible: number; latestRpcResultIsNull: boolean; ownerProfileRowsVisible: number };
    anonymous: { privateAgentRowsVisible: number; identityRowsVisible: number; latestRpcResultIsNull: boolean };
    ordinaryMutationRpc: string;
    ordinaryDirectIdentityInsert: string;
    crossAccountServiceCommand: string;
    broadDefaultAccessObserved: boolean;
    authHttpSignupOrLoginClaimed: boolean;
  };
  atomicity: {
    validAgentAndRevision1Commit: string;
    revision2Append: string;
    invalidCreateResidualRows: Record<string, number>;
    staleRevision: string;
    controllerChange: string;
    externalIdentityConflict: string;
  };
  concurrency: {
    competingRevisionWrites: { clients: number; successes: number; conflicts: number; durableRevisionCount: number };
    competingExternalIdentityClaims: { clients: number; successes: number; conflicts: number; ownershipRows: number; loserAgentRows: number; loserChildRows: number };
    silentOverwriteObserved: boolean;
    duplicateOwnershipObserved: boolean;
  };
  appendOnly: Record<string, string | boolean>;
  durability: {
    independentReconnectVerified: boolean;
    authUsers: number;
    identityProfiles: number;
    distinctIdentityRevisionKeys: number;
    distinctProfileHashes: number;
    columnDocumentAndChainValid: boolean;
    externalIdentityOwners: number;
    distinctExternalIdentityKeys: number;
    externalKeyAndProfileBindingValid: boolean;
    invalidCreateAgentAbsent: boolean;
    raceLoserAgentAbsent: boolean;
  };
  advisors: {
    security: { warningCount: number; leakedPasswordProtectionWarningPresent: boolean; leakedPasswordProtectionEnabledByOwner: boolean; informational: string[] };
    performance: { unindexedForeignKeys: number; unusedIndexes: number; multiplePermissivePolicies: number; authAbsoluteConnectionStrategy: number; disposition: string };
  };
  cleanup: {
    unrelatedAuthRows: number;
    unrelatedProfileRows: number;
    failedTransactionRows: number;
    retainedOwnerAuthRows: number;
    retainedIdentityProfiles: number;
    projectRetained: boolean;
  };
  dataTruth: { fabricatedTrustFoundationRows: number; semanticReviewRows: number; realCustomerDataUsed: boolean };
  repositoryRegression: {
    focused: { filesPassed: number; testsPassed: number };
    lint: string;
    strictTypecheck: string;
    fullSuite: { filesPassed: number; filesSkipped: number; testsPassed: number; testsSkipped: number };
    webProductionBuild: string;
    workerBuild: string;
    gitDiffCheck: string;
    credentialAndPathScan: string;
    historicalEvidenceIntegrity: string;
  };
  historicalEvidence: Array<{ path: string; sha256: string; sidecarsAbsent: boolean }>;
  classification: {
    preliminaryState: string;
    provisionalRealJobs: number;
    canonicalRealVerifiedJobs: number;
    reputationGap: number;
    externalAuditBatchRequired: boolean;
  };
  externalEffects: Record<string, boolean | number>;
};

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(
  workspaceRoot,
  "test-results/beta-gate-1-real-supabase-environment-evidence.json",
);
const reportPath = path.join(workspaceRoot, "BETA_GATE_1_REAL_SUPABASE_ENVIRONMENT_REPORT.md");
const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as GateEvidence;

describe("Beta Gate 1 real Supabase environment evidence", () => {
  it("binds the healthy non-production project to the exact migration bytes", () => {
    expect(evidence.gate).toBe("BETA_GATE_1_REAL_SUPABASE_ENVIRONMENT");
    expect(evidence.status).toBe("MILESTONE_PASS_EXTERNAL_REVIEW_REQUIRED");
    expect(evidence.project).toMatchObject({
      name: "donelayer-beta-validation",
      projectId: "blriuxocrzgwlojiduue",
      purpose: "NON_PRODUCTION_VALIDATION",
      status: "ACTIVE_HEALTHY",
      unrelatedGymProjectAccessedOrModified: false,
    });
    expect(evidence.migrations.map(({ name, remoteVersion }) => ({ name, remoteVersion }))).toEqual([
      { name: "initial_schema", remoteVersion: "20260908165103" },
      { name: "trust_foundation_prerequisite_v1", remoteVersion: "20260909050427" },
      { name: "semantic_verification_v1", remoteVersion: "20260909054834" },
      { name: "agent_identity_production_persistence_v1", remoteVersion: "20260909054923" },
      { name: "beta_gate_1_security_hardening_v1", remoteVersion: "20260909062033" },
    ]);
    for (const migration of evidence.migrations) {
      const actual = createHash("sha256")
        .update(readFileSync(path.join(workspaceRoot, migration.path)))
        .digest("hex");
      expect(actual, migration.path).toBe(migration.sha256);
    }
    expect(evidence.historicalPrerequisiteRootCause).toEqual({
      originalFailure: "42P01_RELATION_JOB_RECEIPTS_DOES_NOT_EXIST",
      reason: expect.any(String),
      historicalMigrationModified: false,
      blockedEvidencePreserved: true,
    });
  });

  it("records fail-closed Auth, RLS, atomicity, concurrency, and append-only outcomes", () => {
    expect(evidence.schemaValidation).toMatchObject({
      constraintsIndexesTriggersRlsAndGrantsCatalogVerified: true,
      semanticReviewRlsEnabled: true,
      semanticReviewClientPolicyCount: 0,
      semanticMutationFunctionSearchPath: "pg_catalog",
      semanticMutationFunctionClientExecute: false,
      semanticMutationFunctionServiceExecute: true,
      schemaConflictsOrDuplicates: 0,
    });
    expect(evidence.authenticationAndRls.owner).toMatchObject({ identityRowsVisibleAtProbe: 2, unrelatedProfileRowsVisible: 0 });
    expect(evidence.authenticationAndRls.unrelated).toEqual({
      safeReference: "unrelated-8d458760",
      authUserId: "8d458760-3cee-4bbb-9d80-29579e5623ed",
      identityRowsVisible: 0,
      latestRpcResultIsNull: true,
      ownProfileRowsVisible: 1,
      ownerProfileRowsVisible: 0,
    });
    expect(evidence.authenticationAndRls.anonymous).toEqual({
      privateAgentRowsVisible: 0,
      identityRowsVisible: 0,
      latestRpcResultIsNull: true,
    });
    expect(evidence.authenticationAndRls).toMatchObject({
      ordinaryMutationRpc: "42501_PERMISSION_DENIED",
      ordinaryDirectIdentityInsert: "42501_PERMISSION_DENIED",
      crossAccountServiceCommand: "42501_AGENT_IDENTITY_ACCESS_DENIED",
      broadDefaultAccessObserved: false,
      authHttpSignupOrLoginClaimed: false,
    });
    expect(Object.values(evidence.atomicity.invalidCreateResidualRows)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(evidence.atomicity).toMatchObject({
      validAgentAndRevision1Commit: "PASS",
      revision2Append: "PASS",
      staleRevision: "23514_AGENT_IDENTITY_REVISION_CHAIN_INVALID",
      controllerChange: "23514_AGENT_IDENTITY_CONTROLLER_MISMATCH",
      externalIdentityConflict: "23505_EXTERNAL_IDENTITY_CONFLICT",
    });
    expect(evidence.concurrency.competingRevisionWrites).toMatchObject({ clients: 2, successes: 1, conflicts: 1, durableRevisionCount: 3 });
    expect(evidence.concurrency.competingExternalIdentityClaims).toMatchObject({ clients: 2, successes: 1, conflicts: 1, ownershipRows: 1, loserAgentRows: 0, loserChildRows: 0 });
    expect(evidence.concurrency).toMatchObject({ silentOverwriteObserved: false, duplicateOwnershipObserved: false });
    expect(evidence.appendOnly).toMatchObject({
      identityUpdate: "55000_APPEND_ONLY",
      identityDelete: "55000_APPEND_ONLY",
      externalOwnerUpdate: "55000_APPEND_ONLY",
      externalOwnerDelete: "55000_APPEND_ONLY",
      targetRowsIntactAfterEveryProbe: true,
      triggerPolicyCascadeOrGrantChangedForProbe: false,
    });
  });

  it("records reconnect durability, bounded cleanup, advisors, and repository validation", () => {
    expect(evidence.durability).toMatchObject({
      independentReconnectVerified: true,
      authUsers: 1,
      identityProfiles: 4,
      distinctIdentityRevisionKeys: 4,
      distinctProfileHashes: 4,
      columnDocumentAndChainValid: true,
      externalIdentityOwners: 2,
      distinctExternalIdentityKeys: 2,
      externalKeyAndProfileBindingValid: true,
      invalidCreateAgentAbsent: true,
      raceLoserAgentAbsent: true,
    });
    expect(evidence.cleanup).toMatchObject({
      unrelatedAuthRows: 0,
      unrelatedProfileRows: 0,
      failedTransactionRows: 0,
      retainedOwnerAuthRows: 1,
      retainedIdentityProfiles: 4,
      projectRetained: true,
    });
    expect(evidence.advisors.security).toMatchObject({
      warningCount: 0,
      leakedPasswordProtectionWarningPresent: false,
      leakedPasswordProtectionEnabledByOwner: true,
    });
    expect(evidence.advisors.security.informational).toHaveLength(2);
    expect(evidence.advisors.performance).toMatchObject({
      unindexedForeignKeys: 9,
      unusedIndexes: 58,
      multiplePermissivePolicies: 2,
      authAbsoluteConnectionStrategy: 1,
      disposition: "RECORDED_NON_BLOCKING_NO_SCOPE_EXPANSION",
    });
    expect(evidence.repositoryRegression).toMatchObject({
      focused: { filesPassed: 5, testsPassed: 30 },
      lint: "PASS_ZERO_WARNINGS",
      strictTypecheck: "PASS",
      fullSuite: { filesPassed: 66, filesSkipped: 7, testsPassed: 325, testsSkipped: 14 },
      webProductionBuild: "PASS_22_STATIC_PAGES",
      workerBuild: "PASS",
      historicalEvidenceIntegrity: "PASS",
    });
    expect(evidence.dataTruth).toEqual({
      fabricatedTrustFoundationRows: 0,
      semanticReviewRows: 0,
      validationRowsClearlyIdentified: true,
      realCustomerDataUsed: false,
    });
  });

  it("preserves historical artifacts, excludes corpus promotion, and contains no credential or local-path leak", () => {
    for (const artifact of evidence.historicalEvidence) {
      const artifactPath = path.join(workspaceRoot, artifact.path);
      expect(existsSync(artifactPath), artifact.path).toBe(true);
      expect(createHash("sha256").update(readFileSync(artifactPath)).digest("hex"), artifact.path)
        .toBe(artifact.sha256);
      expect(existsSync(`${artifactPath}-wal`), artifact.path).toBe(false);
      expect(existsSync(`${artifactPath}-shm`), artifact.path).toBe(false);
      expect(artifact.sidecarsAbsent).toBe(true);
    }
    for (const historicalReport of [
      "BETA_GATE_1_REAL_SUPABASE_MIGRATION_BLOCKED.md",
      "BETA_GATE_1_PREREQUISITE_APPLICATION_AUTH_BLOCKED.md",
      "BETA_GATE_1_REMAINING_MIGRATIONS_AUTH_BLOCKED.md",
      "BETA_GATE_1_SECURITY_HARDENING_AUTH_BLOCKED.md",
      "BETA_GATE_1_DELETE_NEGATIVE_PROBES_AUTH_BLOCKED.md",
      "BETA_GATE_1_AUTH_PASSWORD_PROTECTION_BLOCKED.md",
    ]) {
      expect(existsSync(path.join(workspaceRoot, historicalReport)), historicalReport).toBe(true);
    }
    expect(evidence.classification).toEqual({
      preliminaryState: "NOT_VERIFIED",
      reason: expect.any(String),
      provisionalRealJobs: 0,
      canonicalRealVerifiedJobs: 0,
      reputationGap: 20,
      externalAuditBatchRequired: false,
    });
    expect(evidence.externalEffects).toMatchObject({
      additionalProjectOrBranchCreated: false,
      productionDeployment: false,
      productionPrMerge: false,
      payment: false,
      blockchain: false,
      billingPlanChangeOrPurchase: false,
      realCustomerData: false,
      modelCalls: 0,
      managedSandboxes: 0,
      gymAccessedOrModified: false,
    });
    const serialized = readFileSync(evidencePath, "utf8");
    expect(serialized).not.toMatch(/sb_secret_[A-Za-z0-9_-]+/);
    expect(serialized).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
    expect(serialized).not.toMatch(/[A-Za-z]:\\Users\\/);
    expect(existsSync(reportPath)).toBe(true);
  });
});
