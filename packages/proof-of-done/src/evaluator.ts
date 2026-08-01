import {
  acceptanceCheckSchema,
  evidenceSchema,
  type AcceptanceCheck,
  type AcceptanceCheckInput,
  type Evidence,
  type EvidenceInput,
} from "@donelayer/shared";

export interface AcceptanceCheckResult {
  checkId: string;
  checkType: AcceptanceCheck["type"];
  required: boolean;
  passed: boolean;
  message: string;
  evidenceIds: string[];
}

export interface ProofOfDoneResult {
  passed: boolean;
  requiredCheckCount: number;
  passedRequiredCheckCount: number;
  results: AcceptanceCheckResult[];
}

function evidenceOfType<T extends Evidence["type"]>(
  evidence: readonly Evidence[],
  type: T,
): Array<Extract<Evidence, { type: T }>> {
  return evidence.filter(
    (item): item is Extract<Evidence, { type: T }> => item.type === type,
  );
}

function latest<T>(values: readonly T[]): T | undefined {
  return values.length === 0 ? undefined : values[values.length - 1];
}

function result(
  check: AcceptanceCheck,
  passed: boolean,
  message: string,
  evidenceIds: string[] = [],
): AcceptanceCheckResult {
  return {
    checkId: check.id,
    checkType: check.type,
    required: check.required,
    passed,
    message,
    evidenceIds,
  };
}

function normalizeRelativePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function evaluateCommandExit(
  check: Extract<AcceptanceCheck, { type: "COMMAND_EXIT" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const command = latest(
    evidenceOfType(evidence, "COMMAND").filter(
      (item) => item.commandId === check.commandId,
    ),
  );

  if (!command) {
    return result(check, false, `No result was submitted for ${check.commandId}`);
  }

  const passed = check.allowedExitCodes.includes(command.exitCode);
  return result(
    check,
    passed,
    passed
      ? `${check.commandId} exited with an allowed code (${command.exitCode})`
      : `${check.commandId} exited with ${command.exitCode}`,
    [command.id],
  );
}

function evaluateTest(
  check: Extract<AcceptanceCheck, { type: "TEST" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const test = latest(evidenceOfType(evidence, "TEST"));
  if (!test) {
    return result(check, false, "No structured test result was submitted");
  }

  const countsAreConsistent =
    test.passed + test.failed + test.skipped === test.total;
  const passed =
    countsAreConsistent &&
    test.total >= check.minimumTotal &&
    test.passed >= check.minimumPassed &&
    test.failed <= check.maximumFailed;

  return result(
    check,
    passed,
    passed
      ? `${test.passed} of ${test.total} tests passed`
      : `Test result was ${test.passed} passed, ${test.failed} failed, ${test.skipped} skipped`,
    [test.id],
  );
}

function evaluateBuild(
  check: Extract<AcceptanceCheck, { type: "BUILD" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const build = latest(
    evidenceOfType(evidence, "BUILD").filter(
      (item) => !check.commandId || item.commandId === check.commandId,
    ),
  );
  if (!build) {
    return result(check, false, "No matching build result was submitted");
  }

  const passed = build.success && build.exitCode === 0;
  return result(
    check,
    passed,
    passed ? "Build completed successfully" : `Build exited with ${build.exitCode}`,
    [build.id],
  );
}

function evaluateGitHubCheck(
  check: Extract<AcceptanceCheck, { type: "GITHUB_CHECK" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const githubCheck = latest(
    evidenceOfType(evidence, "GITHUB_CHECK").filter(
      (item) =>
        item.checkName === check.checkName &&
        (!check.repository || item.repository === check.repository),
    ),
  );

  if (!githubCheck) {
    return result(check, false, `No GitHub check result was submitted for ${check.checkName}`);
  }

  const passed = githubCheck.status === "SUCCESS";
  return result(
    check,
    passed,
    `${check.checkName} reported ${githubCheck.status.toLocaleLowerCase("en-US")}`,
    [githubCheck.id],
  );
}

function evaluateDiff(
  check: Extract<AcceptanceCheck, { type: "DIFF" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const diff = latest(evidenceOfType(evidence, "DIFF"));
  if (!diff) {
    return result(check, false, "No Git diff was submitted");
  }

  const changedFileCount = new Set(
    diff.changedFiles.map(normalizeRelativePath),
  ).size;
  const patchPresent = diff.patch.trim().length > 0;
  const passed =
    changedFileCount >= check.minimumChangedFiles &&
    (!check.requireNonEmptyPatch || patchPresent);

  return result(
    check,
    passed,
    passed
      ? `Diff contains ${changedFileCount} changed file(s)`
      : "Submitted diff does not contain the required code changes",
    [diff.id],
  );
}

function evaluateFileExists(
  check: Extract<AcceptanceCheck, { type: "FILE_EXISTS" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const manifests = evidenceOfType(evidence, "FILE_MANIFEST");
  const expectedPath = normalizeRelativePath(check.path);
  const matchingManifest = manifests.find((manifest) =>
    manifest.paths.some(
      (path) => normalizeRelativePath(path) === expectedPath,
    ),
  );

  return result(
    check,
    Boolean(matchingManifest),
    matchingManifest
      ? `${check.path} exists in the submitted workspace manifest`
      : `${check.path} was not found in the submitted workspace manifest`,
    matchingManifest ? [matchingManifest.id] : [],
  );
}

function evaluatePullRequest(
  check: Extract<AcceptanceCheck, { type: "PULL_REQUEST" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const pullRequest = latest(
    evidenceOfType(evidence, "PULL_REQUEST").filter(
      (item) => !check.targetBranch || item.targetBranch === check.targetBranch,
    ),
  );
  if (!pullRequest) {
    return result(check, false, "No matching pull request was submitted");
  }

  const passed = check.allowedStates.includes(
    pullRequest.state as (typeof check.allowedStates)[number],
  );
  return result(
    check,
    passed,
    passed
      ? `Pull request #${pullRequest.number} is ${pullRequest.state.toLocaleLowerCase("en-US")}`
      : `Pull request #${pullRequest.number} is ${pullRequest.state.toLocaleLowerCase("en-US")}`,
    [pullRequest.id],
  );
}

function evaluateUrlHealth(
  check: Extract<AcceptanceCheck, { type: "URL_HEALTH" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const expectedUrl = normalizeUrl(check.url);
  const health = latest(
    evidenceOfType(evidence, "URL_HEALTH").filter(
      (item) => normalizeUrl(item.url) === expectedUrl,
    ),
  );
  if (!health) {
    return result(check, false, `No health result was submitted for ${check.url}`);
  }

  const passed = check.allowedStatuses.includes(health.status);
  return result(
    check,
    passed,
    `${check.url} returned HTTP ${health.status}`,
    [health.id],
  );
}

function evaluateScreenshot(
  check: Extract<AcceptanceCheck, { type: "SCREENSHOT" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const screenshots = evidenceOfType(evidence, "ARTIFACT").filter(
    (item) =>
      item.artifactType === "SCREENSHOT" &&
      allowedMimeTypes.has(item.mimeType.toLocaleLowerCase("en-US")) &&
      item.size > 0 &&
      (!check.fileName || item.fileName === check.fileName),
  );
  const passed = screenshots.length >= check.minimumCount;

  return result(
    check,
    passed,
    passed
      ? `${screenshots.length} screenshot artifact(s) were submitted`
      : `Expected at least ${check.minimumCount} valid screenshot artifact(s)`,
    screenshots.map((item) => item.id),
  );
}

function evaluateHumanApproval(
  check: Extract<AcceptanceCheck, { type: "HUMAN_APPROVAL" }>,
  evidence: readonly Evidence[],
): AcceptanceCheckResult {
  const approvals = evidenceOfType(evidence, "HUMAN_APPROVAL").filter(
    (item) =>
      item.approved &&
      (item.actorKind === check.approverKind ||
        (check.allowAdminOverride && item.actorKind === "ADMIN")),
  );
  const approval = latest(approvals);

  return result(
    check,
    Boolean(approval),
    approval
      ? `Approved by ${approval.actorKind.toLocaleLowerCase("en-US")} ${approval.actorId}`
      : `Approval from ${check.approverKind.toLocaleLowerCase("en-US")} is still required`,
    approval ? [approval.id] : [],
  );
}

export function evaluateAcceptanceCheck(
  checkInput: AcceptanceCheckInput,
  evidenceInputs: readonly EvidenceInput[],
): AcceptanceCheckResult {
  const check = acceptanceCheckSchema.parse(checkInput);
  const evidence = evidenceInputs.map((item) => evidenceSchema.parse(item));

  switch (check.type) {
    case "COMMAND_EXIT":
      return evaluateCommandExit(check, evidence);
    case "TEST":
      return evaluateTest(check, evidence);
    case "BUILD":
      return evaluateBuild(check, evidence);
    case "GITHUB_CHECK":
      return evaluateGitHubCheck(check, evidence);
    case "DIFF":
      return evaluateDiff(check, evidence);
    case "FILE_EXISTS":
      return evaluateFileExists(check, evidence);
    case "PULL_REQUEST":
      return evaluatePullRequest(check, evidence);
    case "URL_HEALTH":
      return evaluateUrlHealth(check, evidence);
    case "SCREENSHOT":
      return evaluateScreenshot(check, evidence);
    case "HUMAN_APPROVAL":
      return evaluateHumanApproval(check, evidence);
  }
}

export function evaluateProofOfDone(
  checkInputs: readonly AcceptanceCheckInput[],
  evidenceInputs: readonly EvidenceInput[],
): ProofOfDoneResult {
  const results = checkInputs.map((check) =>
    evaluateAcceptanceCheck(check, evidenceInputs),
  );
  const requiredResults = results.filter((item) => item.required);
  const passedRequiredCheckCount = requiredResults.filter(
    (item) => item.passed,
  ).length;

  return {
    passed:
      requiredResults.length > 0 &&
      passedRequiredCheckCount === requiredResults.length,
    requiredCheckCount: requiredResults.length,
    passedRequiredCheckCount,
    results,
  };
}
