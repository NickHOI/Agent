import { randomUUID } from "node:crypto";

import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
} from "@donelayer/worker-protocol";

import { materializeVerifiedSourcePackage, type MaterializedSourcePackage } from "../managed-sandbox/repository-source";
import { verifySourcePackage } from "../managed-sandbox/source-package";
import { createAdditionSemanticContract, inspectRepositoryTestOracle, type SemanticTaskContract, type TestOracleInspection } from "./semantic-contract";

export type SemanticSourcePreflight = {
  source: MaterializedSourcePackage;
  contract: SemanticTaskContract;
  files: Array<{ filePath: string; content: string }>;
  inspection: TestOracleInspection;
};

export async function materializeSemanticSourcePreflight(input: {
  branch: typeof REPOSITORY_MATERIALIZATION_BRANCH | typeof REAL_SOURCE_BUG_FIXTURE_BRANCH;
  expectedCommitSha: string;
  taskId?: string;
}): Promise<SemanticSourcePreflight> {
  const source = await materializeVerifiedSourcePackage({
    branch: input.branch,
    expectedCommitSha: input.expectedCommitSha,
    ...(input.branch === REAL_SOURCE_BUG_FIXTURE_BRANCH ? { allowedScenarioBranch: input.branch } : {}),
  });
  if (source.materializerCommitSha !== input.expectedCommitSha || source.independentRemoteCommitSha !== input.expectedCommitSha) {
    throw new Error("SEMANTIC_SOURCE_IDENTITY_MISMATCH");
  }
  const verified = verifySourcePackage({
    sourcePackageBytes: source.sourcePackageBytes,
    sourcePackageManifestBytes: source.sourcePackageManifestBytes,
    expected: source.identity,
  });
  const files = verified.files.map((file) => ({ filePath: file.relativePath, content: file.bytes.toString("utf8") }));
  const contract = createAdditionSemanticContract({
    taskId: input.taskId ?? randomUUID(),
    branch: input.branch,
    commitSha: input.expectedCommitSha,
  });
  const inspection = inspectRepositoryTestOracle({ contract, files });
  return { source, contract, files, inspection };
}
