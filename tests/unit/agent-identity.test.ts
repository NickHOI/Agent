import { describe, expect, it } from "vitest";

import { canonicalJson } from "@donelayer/database";

import { AgentRepairOrchestrator } from "../../apps/web/src/server/agent-execution/agent-repair-orchestrator";
import { DirectOpenAIAgentProvider } from "../../apps/web/src/server/agent-execution/provider";
import {
  AgentIdentityRegistry,
  agentIdentityReceiptBinding,
  agentIdentityReference,
  assertAgentIdentityProfileIntegrity,
  assertExternalIdentityVerified,
  createAgentIdentityProfile,
  createExternalIdentityReference,
  reviseAgentIdentityProfile,
  type AgentIdentityProfile,
  type ExternalAgentIdentityReference,
} from "../../apps/web/src/server/agent-identity/agent-identity";
import {
  assertAgentIdentityGateReceiptIntegrity,
  AgentIdentityGateOrchestrator,
} from "../../apps/web/src/server/agent-identity/agent-identity-gate";
import {
  assertAgentExecutionBinding,
  assertReceiptIdentityBinding,
  createAgentExecutionIdentity,
  generateExecutionId,
} from "../../apps/web/src/server/agent-identity/execution-identity";
import { createAdditionSemanticContract } from "../../apps/web/src/server/semantic-verification/semantic-contract";
import {
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const commitSha = "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00";
const createdAt = "2026-09-03T16:00:00.000Z";

describe("Agent Identity and Interoperability V1", () => {
  it("keeps an opaque internal Agent ID stable across append-only profile revisions", () => {
    const profileV1 = profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5");
    const profileV2 = reviseAgentIdentityProfile({
      current: profileV1,
      expectedRevision: 1,
      patch: { displayName: "Renamed Agent" },
      updatedAt: "2026-09-03T16:01:00.000Z",
    });

    expect(profileV1.agentId).toMatch(/^agt_[A-Za-z0-9_-]{20,64}$/);
    expect(profileV2).toMatchObject({ agentId: profileV1.agentId, revision: 2, displayName: "Renamed Agent" });
    expect(profileV2.previousProfileSha256).toBe(profileV1.profileSha256);
    expect(profileV2.profileSha256).not.toBe(profileV1.profileSha256);
    expect(profileV2.controller).toMatchObject({
      accountId: "platform-provider-account",
      assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
      legallyVerified: false,
    });
    expect(() => profile("30000000-0000-4000-8000-000000000003")).not.toThrow();
  });

  it("distinguishes declared external references from verified linkage and rejects malformed identifiers", () => {
    const declared = ercReference();
    expect(declared.verificationLevel).toBe("DECLARED");
    expect(() => assertExternalIdentityVerified(declared)).toThrow("EXTERNAL_IDENTITY_NOT_VERIFIED");
    expect(() => createExternalIdentityReference({
      ...declared,
      system: "ERC_8004",
      namespace: "eip155:bad:address",
      identifier: "x",
    })).toThrow("EXTERNAL_IDENTITY_IDENTIFIER_INVALID");
    expect(() => createExternalIdentityReference({
      ...declared,
      verificationLevel: "VERIFIED",
    })).toThrow("EXTERNAL_IDENTITY_VERIFICATION_EVIDENCE_REQUIRED");
  });

  it("handles duplicate and conflicting external identity linkage explicitly", () => {
    const registry = new AgentIdentityRegistry();
    const first = registry.register(profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5", [ercReference()]));
    const second = registry.register(profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Z6"));
    expect(() => registry.linkExternalIdentity(first.agentId, 1, ercReference(), "2026-09-03T16:01:00.000Z"))
      .toThrow("EXTERNAL_IDENTITY_DUPLICATE");
    expect(() => registry.linkExternalIdentity(second.agentId, 1, ercReference(), "2026-09-03T16:01:00.000Z"))
      .toThrow("EXTERNAL_IDENTITY_CONFLICT");
  });

  it("binds one Agent profile and a distinct execution identity through Contract, Lease, and Receipt", () => {
    const identity = boundIdentity(profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5"), "identity-binding");
    const receiptBinding = {
      agent: agentIdentityReceiptBinding(identity.profile),
      executionId: identity.execution.executionId,
      executionSha256: identity.execution.executionSha256,
    };

    expect(identity.execution.executionId).toMatch(/^exe_/);
    expect(identity.execution.executionId).not.toBe(identity.profile.agentId);
    expect(identity.contract.assignedAgent).toEqual(agentIdentityReference(identity.profile));
    expect(identity.lease.authority.subject.agentIdentity).toEqual(identity.contract.assignedAgent);
    expect(identity.lease.authority.subject.executionId).toBe(identity.execution.executionId);
    expect(() => assertAgentExecutionBinding(identity)).not.toThrow();
    expect(() => assertReceiptIdentityBinding({ receiptBinding, execution: identity.execution })).not.toThrow();
  });

  it("fails closed for wrong Agent, Work Contract, Permission Lease, execution, and Receipt bindings", () => {
    const first = boundIdentity(profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5"), "identity-first");
    const second = boundIdentity(profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Z6"), "identity-second");

    expect(() => assertAgentExecutionBinding({ execution: second.execution, contract: first.contract, authorityLease: first.lease }))
      .toThrow("AGENT_EXECUTION_IDENTITY_BINDING_MISMATCH");
    expect(() => createAgentExecutionIdentity({
      profile: second.profile,
      contract: first.contract,
      authorityLease: first.lease,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      runtime: { provider: "VERCEL_AI_GATEWAY", modelId: null, sandboxProvider: null },
      startedAt: "2026-09-03T16:00:03.000Z",
    })).toThrow();
    expect(() => assertReceiptIdentityBinding({
      receiptBinding: {
        agent: second.execution.agent,
        executionId: first.execution.executionId,
        executionSha256: first.execution.executionSha256,
      },
      execution: first.execution,
    })).toThrow("AGENT_RECEIPT_IDENTITY_BINDING_MISMATCH");
  });

  it("preserves old Receipt meaning after display mutation and denies disabled or revoked Agents", () => {
    const profileV1 = profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5");
    const bound = boundIdentity(profileV1, "identity-history");
    const historicalBinding = agentIdentityReceiptBinding(profileV1);
    const profileV2 = reviseAgentIdentityProfile({
      current: profileV1,
      expectedRevision: 1,
      patch: { displayName: "New Display Name" },
      updatedAt: "2026-09-03T16:01:00.000Z",
    });
    const disabled = reviseAgentIdentityProfile({
      current: profileV2,
      expectedRevision: 2,
      patch: { status: "DISABLED" },
      updatedAt: "2026-09-03T16:02:00.000Z",
    });

    expect(historicalBinding.displayNameAtExecution).toBe("DoneLayer Gate Agent");
    expect(profileV2.displayName).toBe("New Display Name");
    expect(() => assertReceiptIdentityBinding({
      receiptBinding: {
        agent: historicalBinding,
        executionId: bound.execution.executionId,
        executionSha256: bound.execution.executionSha256,
      },
      execution: bound.execution,
    })).not.toThrow();
    expect(() => createAgentExecutionIdentity({
      profile: disabled,
      contract: bound.contract,
      authorityLease: bound.lease,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      runtime: { provider: "VERCEL_AI_GATEWAY", modelId: null, sandboxProvider: null },
      startedAt: "2026-09-03T16:03:00.000Z",
    })).toThrow("AGENT_IDENTITY_DISABLED");
    const revoked = reviseAgentIdentityProfile({
      current: profileV2,
      expectedRevision: 2,
      patch: { status: "REVOKED" },
      updatedAt: "2026-09-03T16:02:00.000Z",
    });
    expect(() => reviseAgentIdentityProfile({
      current: revoked,
      expectedRevision: 3,
      patch: { displayName: "Cannot rewrite" },
      updatedAt: "2026-09-03T16:03:00.000Z",
    })).toThrow("AGENT_IDENTITY_REVOKED_TERMINAL");
  });

  it("detects profile tampering and requires execution identity before identity-aware repair source access", async () => {
    const identity = boundIdentity(profile("agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5"), "identity-before-source");
    const tampered = structuredClone(identity.profile);
    tampered.displayName = "Tampered";
    expect(() => assertAgentIdentityProfileIntegrity(tampered)).toThrow("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");

    await expect(new AgentRepairOrchestrator(new DirectOpenAIAgentProvider()).run({
      branch: "fixture/real-source-bug-v1",
      expectedCommitSha: commitSha,
      semanticContract: identity.contract,
      authorityLease: identity.lease,
    })).rejects.toThrow("AGENT_EXECUTION_IDENTITY_REQUIRED");
  });

  it("produces a hash-verifiable Gate Receipt with expected DENIED probes and no external live claim", () => {
    const outcome = new AgentIdentityGateOrchestrator().run(new Date("2026-09-03T17:00:00.000Z"));

    expect(outcome).toMatchObject({
      status: "IDENTITY_VERIFIED",
      profiles: [{ revision: 1 }, { revision: 2 }, { revision: 3, status: "DISABLED" }],
      finalLease: { status: "REVOKED" },
      liveExternalProof: { performed: false },
      receipt: { result: "IDENTITY_VERIFIED" },
    });
    expect(outcome.deniedProbes).toHaveLength(10);
    expect(outcome.receipt.document.externalIdentityAdapters).toMatchObject({
      mode: "TYPED_REFERENCES_ONLY",
      liveExternalProofPerformed: false,
      chainRequired: false,
    });
    expect(outcome.receipt.document.externalIdentityAdapters.references.every((item) => item.verificationLevel === "DECLARED")).toBe(true);
    expect(outcome.ledgerVerification.valid).toBe(true);
    expect(() => assertAgentIdentityGateReceiptIntegrity(outcome)).not.toThrow();
  });
});

function profile(agentId: string, externalIdentities: ExternalAgentIdentityReference[] = []) {
  return createAgentIdentityProfile({
    agentId,
    displayName: "DoneLayer Gate Agent",
    controller: {
      controllerType: "PLATFORM_ACCOUNT",
      accountType: "SERVICE_ACCOUNT",
      accountId: "platform-provider-account",
      relationship: "CONTROLS",
      assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
      legallyVerified: false,
    },
    declaredCapabilities: ["bounded-source-repair"],
    externalIdentities,
    createdAt,
  });
}

function boundIdentity(identityProfile: AgentIdentityProfile, taskId: string) {
  const contract = createAdditionSemanticContract({
    taskId,
    branch: "fixture/real-source-bug-v1",
    commitSha,
    assignedAgent: agentIdentityReference(identityProfile),
    lockedAt: "2026-09-03T16:00:01.000Z",
  });
  const executionId = generateExecutionId();
  const lease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({
    contract,
    subject: {
      agentId: identityProfile.agentId,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      jobRunId: `${taskId}-job`,
      agentIdentity: agentIdentityReference(identityProfile),
      executionId,
    },
    decidedAt: "2026-09-03T16:00:02.000Z",
  }));
  const execution = createAgentExecutionIdentity({
    executionId,
    profile: identityProfile,
    contract,
    authorityLease: lease,
    executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
    runtime: { provider: "VERCEL_AI_GATEWAY", modelId: "test-model", sandboxProvider: "VERCEL_SANDBOX" },
    startedAt: "2026-09-03T16:00:03.000Z",
  });
  expect(canonicalJson(lease.authority.subject.agentIdentity)).toBe(canonicalJson(contract.assignedAgent));
  return { profile: identityProfile, contract, authorityLease: lease, lease, execution };
}

function ercReference() {
  return createExternalIdentityReference({
    system: "ERC_8004",
    namespace: "eip155:11155111:0x1111111111111111111111111111111111111111",
    network: "sepolia-test-vector",
    identifier: "42",
    verificationLevel: "DECLARED",
    verificationMethod: null,
    evidenceSha256: null,
    linkedAt: createdAt,
    verifiedAt: null,
  });
}
