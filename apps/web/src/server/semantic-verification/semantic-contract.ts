import { createHash } from "node:crypto";

import { canonicalJson } from "@donelayer/database";
import ts from "typescript";

import {
  assertAgentIdentityReference,
  type AgentIdentityReference,
} from "../agent-identity/agent-identity";

export const SEMANTIC_VERIFICATION_GATE = "SEMANTIC_VERIFICATION_SPEC_TEST_CONFLICT_V1" as const;
export const VERIFIED_WORK_CONTRACT_GATE = "VERIFIED_WORK_CONTRACT_V1_DESIGN_AND_EVIDENCE_GATE" as const;
export const SEMANTIC_CONTRACT_TYPE = "VERIFIED_WORK_CONTRACT_V1" as const;
export const VERIFIED_WORK_EVIDENCE_BUNDLE_TYPE = "VERIFIED_WORK_EVIDENCE_BUNDLE_V1" as const;

export const VERIFIED_WORK_REQUIRED_EVIDENCE = [
  "SOURCE_IDENTITY",
  "PERMISSION_DECISION",
  "AGENT_ACTIONS",
  "SOURCE_CHANGES",
  "REPOSITORY_TESTS",
  "CONTRACT_ASSERTIONS",
  "EXECUTION_ENVIRONMENT",
  "SOURCE_INTEGRITY",
  "CLEANUP",
] as const;

const VERIFICATION_DIMENSIONS = [
  "EXECUTION_INTEGRITY",
  "TEST_CONFORMITY",
  "CONTRACT_CONFORMITY",
  "DELIVERY_INTEGRITY",
] as const;

export type SemanticVerificationOutcome =
  | "CONTRACT_VERIFIED"
  | "SPEC_TEST_CONFLICT"
  | "TEST_ORACLE_SUSPECT"
  | "ACCEPTANCE_CRITERIA_CONFLICT"
  | "ENGINEERING_REVIEW_REQUIRED";

export type StructuredContractAssertion = {
  id: string;
  kind: "FUNCTION_EXAMPLE_V1";
  modulePath: string;
  exportName: string;
  args: number[];
  expected: number;
};

export type SemanticTaskContract = {
  schemaVersion: 1;
  contractVersion: 1;
  contractType: typeof SEMANTIC_CONTRACT_TYPE;
  status: "LOCKED";
  taskId: string;
  assignedAgent?: AgentIdentityReference;
  specification: string;
  desiredOutcome: string;
  repository: "NickHOI/donelayer-build-rescue-fixture";
  remoteUrl: "https://github.com/NickHOI/donelayer-build-rescue-fixture.git";
  branch: string;
  commitSha: string;
  assertions: StructuredContractAssertion[];
  assertionsSha256: string;
  authoritativeOracle: "LOCKED_CONTRACT_ASSERTIONS";
  repositoryTestRole: "CONFORMITY_EVIDENCE";
  acceptanceCriteria: {
    authority: "OWNER_LOCKED_STRUCTURED_ASSERTIONS";
    assertionsSha256: string;
    immutableAfterLock: true;
  };
  permissionPolicy: {
    allowedActions: string[];
    forbiddenActions: string[];
  };
  requiredEvidence: Array<(typeof VERIFIED_WORK_REQUIRED_EVIDENCE)[number]>;
  verificationPolicy: {
    dimensions: Array<(typeof VERIFICATION_DIMENSIONS)[number]>;
    deterministicVerifier: "NON_AI_DETERMINISTIC_VERIFIER";
    agentReportedCompletionIsSufficient: false;
    aiSoleJudgeAllowed: false;
    insufficientEvidenceOutcome: "ENGINEERING_REVIEW_REQUIRED";
  };
  outcomePolicy: {
    agentReported: "AGENT_REPORTED_COMPLETE";
    verifiedSuccess: "VERIFIED_DELIVERY";
    verificationFailure: "FAILED";
    reviewRequired: "ENGINEERING_REVIEW_REQUIRED";
    correction: "SUPERSEDED";
  };
  lockedAt: string;
  workContractSha256: string;
};

export type VerifiedWorkEvidenceReference = {
  kind:
    | "WORK_CONTRACT"
    | "PERMISSION_DECISION"
    | "SOURCE_MANIFEST"
    | "TEST_ORACLE_INSPECTION"
    | "AGENT_REPAIR_RECEIPT"
    | "REPAIR_PATCH"
    | "DELIVERY_DIFF"
    | "INDEPENDENT_VERIFICATION"
    | "HISTORICAL_RECEIPT";
  sha256: string;
};

export type VerifiedWorkEvidenceBundle = {
  schemaVersion: 1;
  bundleType: typeof VERIFIED_WORK_EVIDENCE_BUNDLE_TYPE;
  workContractSha256: string;
  source: {
    remoteUrl: SemanticTaskContract["remoteUrl"];
    branch: string;
    commitSha: string;
  };
  completion: {
    agentReported: "REPORTED" | "NOT_REPORTED";
    independentlyVerified: "VERIFIED_DELIVERY" | "ENGINEERING_REVIEW_REQUIRED" | "SUPERSEDED" | "FAILED";
  };
  dimensions: {
    executionIntegrity: "VALID" | "INVALID" | "NOT_RUN";
    testConformity: "PASSED" | "FAILED" | "CONFLICT" | "NOT_RUN";
    contractConformity: "VERIFIED" | "FAILED" | "CONFLICT" | "REVIEW_REQUIRED" | "NOT_RUN";
    deliveryIntegrity: "VALID" | "INVALID" | "NOT_RUN";
  };
  projection: {
    required: Array<(typeof VERIFIED_WORK_REQUIRED_EVIDENCE)[number]>;
    satisfied: Array<(typeof VERIFIED_WORK_REQUIRED_EVIDENCE)[number]>;
    missing: Array<(typeof VERIFIED_WORK_REQUIRED_EVIDENCE)[number]>;
    complete: boolean;
  };
  evidence: VerifiedWorkEvidenceReference[];
  createdAt: string;
  bundleSha256: string;
};

export type RepositoryTestExpectation = {
  filePath: string;
  line: number;
  exportName: string;
  args: number[];
  expected: number;
};

export type TestOracleInspection = {
  outcome: SemanticVerificationOutcome;
  assertionsSha256: string;
  inspectedFiles: string[];
  expectations: RepositoryTestExpectation[];
  matches: Array<{
    assertionId: string;
    expected: number;
    repositoryExpected: number;
    filePath: string;
    line: number;
  }>;
  conflicts: Array<{
    assertionId: string;
    expected: number;
    repositoryExpected: number;
    filePath: string;
    line: number;
  }>;
  missingAssertionIds: string[];
  unsupportedRelevantAssertions: Array<{ filePath: string; line: number }>;
  summary: string;
};

export type ContractAssertionRun = {
  schemaVersion: 1;
  assertionsSha256: string;
  passed: number;
  failed: number;
  results: Array<{
    assertionId: string;
    args: number[];
    expected: number;
    actual: unknown;
    status: "PASSED" | "FAILED";
  }>;
};

export function createAdditionSemanticContract(input: {
  taskId: string;
  branch: string;
  commitSha: string;
  assignedAgent?: AgentIdentityReference;
  lockedAt?: string;
}): SemanticTaskContract {
  const assertions: StructuredContractAssertion[] = [
    assertion("add-2-3", [2, 3], 5),
    assertion("add-2-2", [2, 2], 4),
    assertion("add-0-0", [0, 0], 0),
    assertion("add-neg1-1", [-1, 1], 0),
  ];
  const contract: Omit<SemanticTaskContract, "workContractSha256"> = {
    schemaVersion: 1,
    contractVersion: 1,
    contractType: SEMANTIC_CONTRACT_TYPE,
    status: "LOCKED",
    taskId: requiredText(input.taskId, "Task ID"),
    ...(input.assignedAgent ? { assignedAgent: structuredClone(input.assignedAgent) } : {}),
    specification: "add(left, right) returns the ordinary arithmetic sum of the two numeric inputs.",
    desiredOutcome: "Repair src/add.ts so it satisfies ordinary arithmetic addition without modifying tests or acceptance criteria.",
    repository: "NickHOI/donelayer-build-rescue-fixture",
    remoteUrl: "https://github.com/NickHOI/donelayer-build-rescue-fixture.git",
    branch: requiredBranch(input.branch),
    commitSha: requiredCommit(input.commitSha),
    assertions,
    assertionsSha256: semanticAssertionsSha256(assertions),
    authoritativeOracle: "LOCKED_CONTRACT_ASSERTIONS",
    repositoryTestRole: "CONFORMITY_EVIDENCE",
    acceptanceCriteria: {
      authority: "OWNER_LOCKED_STRUCTURED_ASSERTIONS",
      assertionsSha256: semanticAssertionsSha256(assertions),
      immutableAfterLock: true,
    },
    permissionPolicy: {
      allowedActions: ["read_source", "run_fixed_tests", "modify_src_add", "create_patch", "create_delivery_branch", "create_pull_request"],
      forbiddenActions: ["modify_tests", "modify_acceptance_criteria", "push_default_branch", "merge_pull_request", "production_deploy", "real_payment"],
    },
    requiredEvidence: [...VERIFIED_WORK_REQUIRED_EVIDENCE],
    verificationPolicy: {
      dimensions: [...VERIFICATION_DIMENSIONS],
      deterministicVerifier: "NON_AI_DETERMINISTIC_VERIFIER",
      agentReportedCompletionIsSufficient: false,
      aiSoleJudgeAllowed: false,
      insufficientEvidenceOutcome: "ENGINEERING_REVIEW_REQUIRED",
    },
    outcomePolicy: {
      agentReported: "AGENT_REPORTED_COMPLETE",
      verifiedSuccess: "VERIFIED_DELIVERY",
      verificationFailure: "FAILED",
      reviewRequired: "ENGINEERING_REVIEW_REQUIRED",
      correction: "SUPERSEDED",
    },
    lockedAt: input.lockedAt ?? new Date().toISOString(),
  };
  return { ...contract, workContractSha256: digest(canonicalJson(contract)) };
}

export function semanticAssertionsSha256(assertions: StructuredContractAssertion[]): string {
  return digest(canonicalJson(assertions));
}

export function assertSemanticContractIntegrity(contract: SemanticTaskContract): void {
  const { workContractSha256, ...contractBody } = contract;
  if (
    contract.schemaVersion !== 1 ||
    contract.contractVersion !== 1 ||
    contract.contractType !== SEMANTIC_CONTRACT_TYPE ||
    contract.status !== "LOCKED" ||
    contract.assertions.length < 1 ||
    semanticAssertionsSha256(contract.assertions) !== contract.assertionsSha256 ||
    contract.acceptanceCriteria.authority !== "OWNER_LOCKED_STRUCTURED_ASSERTIONS" ||
    contract.acceptanceCriteria.assertionsSha256 !== contract.assertionsSha256 ||
    contract.acceptanceCriteria.immutableAfterLock !== true ||
    canonicalJson(contract.requiredEvidence) !== canonicalJson(VERIFIED_WORK_REQUIRED_EVIDENCE) ||
    canonicalJson(contract.verificationPolicy.dimensions) !== canonicalJson(VERIFICATION_DIMENSIONS) ||
    contract.verificationPolicy.deterministicVerifier !== "NON_AI_DETERMINISTIC_VERIFIER" ||
    contract.verificationPolicy.agentReportedCompletionIsSufficient !== false ||
    contract.verificationPolicy.aiSoleJudgeAllowed !== false ||
    contract.verificationPolicy.insufficientEvidenceOutcome !== "ENGINEERING_REVIEW_REQUIRED" ||
    digest(canonicalJson(contractBody)) !== workContractSha256
  ) throw new Error("CONTRACT_ASSERTION_TAMPERING_DETECTED");
  if (contract.assignedAgent) assertAgentIdentityReference(contract.assignedAgent);
  const ids = new Set<string>();
  for (const item of contract.assertions) {
    if (
      item.kind !== "FUNCTION_EXAMPLE_V1" ||
      !item.id || ids.has(item.id) ||
      item.modulePath !== "src/add.ts" ||
      item.exportName !== "add" ||
      item.args.length !== 2 ||
      item.args.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(item.expected)
    ) throw new Error("CONTRACT_ASSERTION_INVALID");
    ids.add(item.id);
  }
}

export function createVerifiedWorkEvidenceBundle(input: {
  contract: SemanticTaskContract;
  agentReported: VerifiedWorkEvidenceBundle["completion"]["agentReported"];
  independentlyVerified: VerifiedWorkEvidenceBundle["completion"]["independentlyVerified"];
  dimensions: VerifiedWorkEvidenceBundle["dimensions"];
  evidence: VerifiedWorkEvidenceReference[];
  createdAt?: string;
}): VerifiedWorkEvidenceBundle {
  assertSemanticContractIntegrity(input.contract);
  const evidence = [...input.evidence].sort((left, right) => left.kind.localeCompare(right.kind));
  const projection = evidenceProjection(evidence);
  const withoutHash: Omit<VerifiedWorkEvidenceBundle, "bundleSha256"> = {
    schemaVersion: 1,
    bundleType: VERIFIED_WORK_EVIDENCE_BUNDLE_TYPE,
    workContractSha256: input.contract.workContractSha256,
    source: {
      remoteUrl: input.contract.remoteUrl,
      branch: input.contract.branch,
      commitSha: input.contract.commitSha,
    },
    completion: {
      agentReported: input.agentReported,
      independentlyVerified: input.independentlyVerified,
    },
    dimensions: input.dimensions,
    projection,
    evidence,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const bundle = { ...withoutHash, bundleSha256: digest(canonicalJson(withoutHash)) };
  assertVerifiedWorkEvidenceBundleIntegrity(bundle, input.contract);
  return bundle;
}

export function assertVerifiedWorkEvidenceBundleIntegrity(
  bundle: VerifiedWorkEvidenceBundle,
  contract: SemanticTaskContract,
): void {
  assertSemanticContractIntegrity(contract);
  const { bundleSha256, ...bundleBody } = bundle;
  const kinds = bundle.evidence.map((item) => item.kind);
  const verified = bundle.completion.independentlyVerified === "VERIFIED_DELIVERY";
  const projection = evidenceProjection(bundle.evidence);
  if (
    bundle.schemaVersion !== 1 ||
    bundle.bundleType !== VERIFIED_WORK_EVIDENCE_BUNDLE_TYPE ||
    bundle.workContractSha256 !== contract.workContractSha256 ||
    bundle.source.remoteUrl !== contract.remoteUrl ||
    bundle.source.branch !== contract.branch ||
    bundle.source.commitSha !== contract.commitSha ||
    !Number.isFinite(Date.parse(bundle.createdAt)) ||
    digest(canonicalJson(bundleBody)) !== bundleSha256 ||
    new Set(kinds).size !== kinds.length ||
    canonicalJson(kinds) !== canonicalJson([...kinds].sort()) ||
    canonicalJson(bundle.projection) !== canonicalJson(projection) ||
    bundle.evidence.some((item) => !/^[a-f0-9]{64}$/.test(item.sha256)) ||
    !kinds.includes("WORK_CONTRACT") ||
    (verified && (
      bundle.completion.agentReported !== "REPORTED" ||
      !bundle.projection.complete ||
      bundle.dimensions.executionIntegrity !== "VALID" ||
      bundle.dimensions.testConformity !== "PASSED" ||
      bundle.dimensions.contractConformity !== "VERIFIED" ||
      bundle.dimensions.deliveryIntegrity !== "VALID"
    ))
  ) throw new Error("VERIFIED_WORK_EVIDENCE_BUNDLE_TAMPERING_DETECTED");
}

function evidenceProjection(evidence: VerifiedWorkEvidenceReference[]): VerifiedWorkEvidenceBundle["projection"] {
  const satisfied = new Set<(typeof VERIFIED_WORK_REQUIRED_EVIDENCE)[number]>();
  for (const item of evidence) {
    if (item.kind === "PERMISSION_DECISION") satisfied.add("PERMISSION_DECISION");
    if (item.kind === "SOURCE_MANIFEST") {
      satisfied.add("SOURCE_IDENTITY");
      satisfied.add("SOURCE_INTEGRITY");
    }
    if (item.kind === "AGENT_REPAIR_RECEIPT") satisfied.add("AGENT_ACTIONS");
    if (item.kind === "REPAIR_PATCH") satisfied.add("SOURCE_CHANGES");
    if (item.kind === "TEST_ORACLE_INSPECTION") satisfied.add("REPOSITORY_TESTS");
    if (item.kind === "INDEPENDENT_VERIFICATION") {
      satisfied.add("REPOSITORY_TESTS");
      satisfied.add("CONTRACT_ASSERTIONS");
      satisfied.add("EXECUTION_ENVIRONMENT");
      satisfied.add("SOURCE_INTEGRITY");
      satisfied.add("CLEANUP");
    }
  }
  const required = [...VERIFIED_WORK_REQUIRED_EVIDENCE];
  const satisfiedList = required.filter((item) => satisfied.has(item));
  const missing = required.filter((item) => !satisfied.has(item));
  return { required, satisfied: satisfiedList, missing, complete: missing.length === 0 };
}

export function inspectRepositoryTestOracle(input: {
  contract: SemanticTaskContract;
  files: Array<{ filePath: string; content: string }>;
}): TestOracleInspection {
  assertSemanticContractIntegrity(input.contract);
  const testFiles = input.files
    .filter((file) => file.filePath.startsWith("tests/") && /\.[cm]?[jt]sx?$/.test(file.filePath))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  const relevantExports = new Set(input.contract.assertions.map((item) => item.exportName));
  const expectations: RepositoryTestExpectation[] = [];
  const unsupportedRelevantAssertions: Array<{ filePath: string; line: number }> = [];

  for (const file of testFiles) {
    const source = ts.createSourceFile(file.filePath, file.content, ts.ScriptTarget.Latest, true, scriptKind(file.filePath));
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isEqualityAssertion(node.expression)) {
        const actual = node.arguments[0];
        const expected = node.arguments[1];
        if (actual && ts.isCallExpression(actual) && ts.isIdentifier(actual.expression) && relevantExports.has(actual.expression.text)) {
          const args = actual.arguments.map(numericLiteral);
          const expectedValue = expected ? numericLiteral(expected) : null;
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          if (args.every((value): value is number => value !== null) && expectedValue !== null) {
            expectations.push({ filePath: file.filePath, line, exportName: actual.expression.text, args, expected: expectedValue });
          } else {
            unsupportedRelevantAssertions.push({ filePath: file.filePath, line });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const matches: TestOracleInspection["matches"] = [];
  const conflicts: TestOracleInspection["conflicts"] = [];
  const missingAssertionIds: string[] = [];
  for (const assertion of input.contract.assertions) {
    const candidates = expectations.filter((candidate) =>
      candidate.exportName === assertion.exportName && canonicalJson(candidate.args) === canonicalJson(assertion.args));
    if (candidates.length === 0) {
      missingAssertionIds.push(assertion.id);
      continue;
    }
    for (const candidate of candidates) {
      const comparison = {
        assertionId: assertion.id,
        expected: assertion.expected,
        repositoryExpected: candidate.expected,
        filePath: candidate.filePath,
        line: candidate.line,
      };
      if (Object.is(candidate.expected, assertion.expected)) matches.push(comparison);
      else conflicts.push(comparison);
    }
  }

  const outcome: SemanticVerificationOutcome = conflicts.length > 0
    ? "SPEC_TEST_CONFLICT"
    : unsupportedRelevantAssertions.length > 0 || missingAssertionIds.length > 0
      ? "TEST_ORACLE_SUSPECT"
      : "CONTRACT_VERIFIED";
  const summary = outcome === "SPEC_TEST_CONFLICT"
    ? `${conflicts.length} repository test expectation(s) conflict with locked Contract assertions.`
    : outcome === "TEST_ORACLE_SUSPECT"
      ? "Repository tests do not provide an unambiguous expectation for every locked Contract assertion."
      : "Repository test expectations agree with every locked Contract assertion.";
  return {
    outcome,
    assertionsSha256: input.contract.assertionsSha256,
    inspectedFiles: testFiles.map((file) => file.filePath),
    expectations,
    matches,
    conflicts,
    missingAssertionIds,
    unsupportedRelevantAssertions,
    summary,
  };
}

export function createContractAssertionRunner(
  contract: SemanticTaskContract,
  options: { sourceRoot?: string } = {},
): string {
  assertSemanticContractIntegrity(contract);
  const sourceRoot = options.sourceRoot ?? ".";
  if (!/^\.{1,2}(?:\/[a-zA-Z0-9._-]+)*$/.test(sourceRoot)) throw new Error("Contract assertion Source root is invalid");
  const modulePath = `${sourceRoot}/${contract.assertions[0]!.modulePath}`.replace("././", "./");
  const assertions = contract.assertions.map((item) => ({
    id: item.id,
    args: item.args,
    expected: item.expected,
  }));
  return [
    `import { ${contract.assertions[0]!.exportName} } from ${JSON.stringify(modulePath)};`,
    `const assertions = ${JSON.stringify(assertions)};`,
    `const assertionsSha256 = ${JSON.stringify(contract.assertionsSha256)};`,
    "const results = assertions.map((item) => {",
    "  const actual = add(...item.args);",
    "  return { assertionId: item.id, args: item.args, expected: item.expected, actual, status: Object.is(actual, item.expected) ? \"PASSED\" : \"FAILED\" };",
    "});",
    "const output = { schemaVersion: 1, assertionsSha256, passed: results.filter((item) => item.status === \"PASSED\").length, failed: results.filter((item) => item.status === \"FAILED\").length, results };",
    "console.log(JSON.stringify(output));",
    "if (output.failed > 0) process.exitCode = 1;",
    "",
  ].join("\n");
}

export function parseContractAssertionRun(output: string, contract: SemanticTaskContract): ContractAssertionRun {
  assertSemanticContractIntegrity(contract);
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  let parsed: unknown = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      parsed = JSON.parse(lines[index]!);
      break;
    } catch {
      // Continue through command chatter until the structured result is found.
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CONTRACT_ASSERTION_RESULT_INVALID");
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    value.assertionsSha256 !== contract.assertionsSha256 ||
    !Number.isSafeInteger(value.passed) ||
    !Number.isSafeInteger(value.failed) ||
    !Array.isArray(value.results) ||
    value.results.length !== contract.assertions.length ||
    Number(value.passed) + Number(value.failed) !== contract.assertions.length
  ) throw new Error("CONTRACT_ASSERTION_RESULT_TAMPERING_DETECTED");
  const expectedById = new Map(contract.assertions.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const raw of value.results) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CONTRACT_ASSERTION_RESULT_INVALID");
    const result = raw as Record<string, unknown>;
    const id = String(result.assertionId);
    const expected = expectedById.get(id);
    if (
      !expected || seen.has(id) ||
      canonicalJson(result.args) !== canonicalJson(expected.args) ||
      !Object.is(result.expected, expected.expected) ||
      (result.status !== "PASSED" && result.status !== "FAILED") ||
      (result.status === "PASSED" && !Object.is(result.actual, expected.expected)) ||
      (result.status === "FAILED" && Object.is(result.actual, expected.expected))
    ) throw new Error("CONTRACT_ASSERTION_RESULT_TAMPERING_DETECTED");
    seen.add(id);
  }
  return value as unknown as ContractAssertionRun;
}

function assertion(id: string, args: number[], expected: number): StructuredContractAssertion {
  return { id, kind: "FUNCTION_EXAMPLE_V1", modulePath: "src/add.ts", exportName: "add", args, expected };
}

function isEqualityAssertion(expression: ts.LeftHandSideExpression): boolean {
  if (!ts.isPropertyAccessExpression(expression)) return false;
  return ["equal", "strictEqual"].includes(expression.name.text) &&
    (ts.isIdentifier(expression.expression) || ts.isPropertyAccessExpression(expression.expression));
}

function numericLiteral(node: ts.Expression): number | null {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(node.operand)
  ) return (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1) * Number(node.operand.text);
  return null;
}

function scriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function requiredCommit(value: string): string {
  const commit = value.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Semantic Contract Commit SHA is invalid");
  return commit;
}

function requiredBranch(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,254}$/.test(value) || value.includes("..") || value.endsWith("/")) {
    throw new Error("Semantic Contract branch is invalid");
  }
  return value;
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
