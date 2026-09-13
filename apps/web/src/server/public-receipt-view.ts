import type { PublicJobReceipt } from "@donelayer/database";

export function toPublicReceiptView(receipt: PublicJobReceipt): PublicJobReceipt {
  return {
    publicReceiptId: receipt.publicReceiptId,
    taskType: receipt.taskType,
    agentIdentity: receipt.agentIdentity,
    ...(receipt.agentIdentityBinding ? { agentIdentityBinding: { ...receipt.agentIdentityBinding } } : {}),
    workerIdentity: receipt.workerIdentity,
    contractSha256: receipt.contractSha256,
    evidenceChainSha256: receipt.evidenceChainSha256,
    artifactSha256: receipt.artifactSha256,
    verificationSummary: receipt.verificationSummary,
    result: receipt.result,
    createdAt: receipt.createdAt,
    verificationStatus: receipt.verificationStatus,
    invalidated: receipt.invalidated,
    disputed: receipt.disputed,
    ...(receipt.repository ? { repository: { ...receipt.repository } } : {}),
    ...(receipt.managedSandbox ? { managedSandbox: { ...receipt.managedSandbox } } : {}),
    ...(receipt.buildTest
      ? {
          buildTest: {
            sourceManifestSha256: receipt.buildTest.sourceManifestSha256,
            sourcePackageSha256: receipt.buildTest.sourcePackageSha256,
            nodeVersion: receipt.buildTest.nodeVersion,
            npmVersion: receipt.buildTest.npmVersion,
            install: publicCommandSummary(receipt.buildTest.install),
            build: publicCommandSummary(receipt.buildTest.build),
            test: publicCommandSummary(receipt.buildTest.test),
            testRunner: receipt.buildTest.testRunner,
            totalTests: receipt.buildTest.totalTests,
            passedTests: receipt.buildTest.passedTests,
            failedTests: receipt.buildTest.failedTests,
            statisticsStatus: receipt.buildTest.statisticsStatus,
            sourceMutationDetected: receipt.buildTest.sourceMutationDetected,
            networkViolationCount: receipt.buildTest.networkViolationCount,
            permissionViolationCount: receipt.buildTest.permissionViolationCount,
            providerPayoutReleased: receipt.buildTest.providerPayoutReleased,
          },
        }
      : {}),
    ...(receipt.agentRepair
      ? { agentRepair: { ...receipt.agentRepair, modifiedFiles: [...receipt.agentRepair.modifiedFiles] } }
      : {}),
    ...(receipt.githubDelivery ? { githubDelivery: { ...receipt.githubDelivery } } : {}),
    ...(receipt.semanticVerification ? { semanticVerification: { ...receipt.semanticVerification } } : {}),
    ...(receipt.verifiedDeliveryOutcomes
      ? { verifiedDeliveryOutcomes: { ...receipt.verifiedDeliveryOutcomes } }
      : {}),
    scopeDisclaimer: receipt.scopeDisclaimer
  };
}

function publicCommandSummary(
  command: NonNullable<PublicJobReceipt["buildTest"]>["install"],
): NonNullable<PublicJobReceipt["buildTest"]>["install"] {
  return {
    command: command.command,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    status: command.status,
    stdoutArtifact: { ...command.stdoutArtifact },
    stderrArtifact: { ...command.stderrArtifact },
  };
}
