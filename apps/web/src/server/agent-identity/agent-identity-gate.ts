import { randomBytes, randomUUID } from "node:crypto";

import {
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  sha256Canonical,
} from "@donelayer/database";
import { REAL_SOURCE_BUG_FIXTURE_BRANCH } from "@donelayer/worker-protocol";

import { createAdditionSemanticContract, type SemanticTaskContract } from "../semantic-verification/semantic-contract";
import {
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
  TASK_SCOPED_AUTHORITY_ISSUER,
  type TaskScopedPermissionLease,
} from "../task-scoped-authority/task-scoped-authority";
import {
  AGENT_IDENTITY_GATE,
  AGENT_IDENTITY_GATE_AGENT_ID,
  AgentIdentityRegistry,
  agentIdentityReceiptBinding,
  agentIdentityReference,
  assertAgentIdentityProfileIntegrity,
  assertExternalIdentityVerified,
  createAgentIdentityProfile,
  createExternalIdentityReference,
  type AgentIdentityProfile,
  type AgentIdentityReceiptBinding,
  type ExternalAgentIdentityReference,
} from "./agent-identity";
import {
  assertAgentExecutionBinding,
  assertReceiptIdentityBinding,
  createAgentExecutionIdentity,
  generateExecutionId,
  type AgentExecutionIdentity,
} from "./execution-identity";

const FIXTURE_COMMIT = "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00";
const GATE_CONTROLLER_ID = "done-layer-platform-provider";

type IdentityLedgerEntry = {
  id: string;
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
};

export type IdentityDeniedProbe = {
  id: string;
  decision: "DENIED";
  reason: string;
  recordedAt: string;
};

export type AgentIdentityGateReceipt = {
  schemaVersion: 1;
  receiptType: "AGENT_IDENTITY_INTEROPERABILITY_VERIFICATION";
  publicReceiptId: string;
  gate: typeof AGENT_IDENTITY_GATE;
  finalResult: "IDENTITY_VERIFIED";
  identity: {
    agent: AgentIdentityReceiptBinding;
    profileHistory: Array<{
      revision: number;
      profileSha256: string;
      previousProfileSha256: string | null;
      displayName: string;
      status: AgentIdentityProfile["status"];
    }>;
    latestProfileRevision: number;
    latestProfileSha256: string;
  };
  workContract: {
    id: string;
    version: number;
    sha256: string;
    assignedAgent: NonNullable<SemanticTaskContract["assignedAgent"]>;
  };
  authority: {
    leaseId: string;
    version: number;
    authoritySha256: string;
    subject: TaskScopedPermissionLease["authority"]["subject"];
    terminalStatus: "REVOKED";
  };
  execution: AgentExecutionIdentity;
  externalIdentityAdapters: {
    mode: "TYPED_REFERENCES_ONLY";
    references: ExternalAgentIdentityReference[];
    liveExternalProofPerformed: false;
    chainRequired: false;
  };
  deniedProbes: IdentityDeniedProbe[];
  evidenceLedger: {
    valid: boolean;
    entryCount: number;
    chainSha256: string | null;
  };
  issuedAt: string;
};

export type AgentIdentityGateOutcome = {
  gate: typeof AGENT_IDENTITY_GATE;
  status: "IDENTITY_VERIFIED";
  profiles: AgentIdentityProfile[];
  contract: SemanticTaskContract;
  issuedLease: TaskScopedPermissionLease;
  finalLease: TaskScopedPermissionLease;
  execution: AgentExecutionIdentity;
  deniedProbes: IdentityDeniedProbe[];
  liveExternalProof: {
    performed: false;
    reason: string;
  };
  ledgerEntries: IdentityLedgerEntry[];
  ledgerVerification: {
    valid: boolean;
    entryCount: number;
    chainSha256: string | null;
  };
  receipt: {
    id: string;
    publicReceiptId: string;
    result: "IDENTITY_VERIFIED";
    receiptSha256: string;
    evidenceChainSha256: string;
    document: AgentIdentityGateReceipt;
  };
};

export class AgentIdentityGateOrchestrator {
  run(startedAt = new Date()): AgentIdentityGateOutcome {
    const timestamp = (offsetMs: number) => new Date(startedAt.getTime() + offsetMs).toISOString();
    const registry = new AgentIdentityRegistry();
    const ledger = new IdentityLedger();
    const externalIdentities = gateExternalIdentityReferences(timestamp(0));
    const profileV1 = registry.register(createAgentIdentityProfile({
      agentId: AGENT_IDENTITY_GATE_AGENT_ID,
      displayName: "DoneLayer Coding Agent",
      controller: {
        controllerType: "PLATFORM_ACCOUNT",
        accountType: "SERVICE_ACCOUNT",
        accountId: GATE_CONTROLLER_ID,
        relationship: "CONTROLS",
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      declaredCapabilities: ["bounded-source-repair", "controlled-tool-use"],
      runtimeReferences: [{
        system: "VERCEL_AI_GATEWAY",
        identifier: "agent-repair-provider-adapter",
        verificationLevel: "OBSERVED",
      }],
      externalIdentities,
      createdAt: timestamp(0),
    }));
    ledger.append("AGENT_IDENTITY_CREATED", "agent_identity_profile", profileV1.agentId, profileV1, timestamp(0));
    for (const reference of profileV1.externalIdentities) {
      ledger.append("EXTERNAL_IDENTITY_LINKED", "external_agent_identity", `${reference.system}:${reference.identifier}`, reference, timestamp(0));
    }

    const contract = createAdditionSemanticContract({
      taskId: `agent-identity-gate-${randomUUID()}`,
      branch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
      commitSha: FIXTURE_COMMIT,
      assignedAgent: agentIdentityReference(profileV1),
      lockedAt: timestamp(1_000),
    });
    ledger.append("CONTRACT_LOCKED", "semantic_task_contract", contract.taskId, {
      workContractSha256: contract.workContractSha256,
      assignedAgent: contract.assignedAgent,
    }, contract.lockedAt);

    const executionId = generateExecutionId();
    const subject = {
      agentId: profileV1.agentId,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      jobRunId: randomUUID(),
      agentIdentity: agentIdentityReference(profileV1),
      executionId,
    };
    const decision = decideTaskScopedAuthority({ contract, subject, decidedAt: timestamp(2_000) });
    const issuedLease = issueTaskScopedPermissionLease(decision);
    ledger.append("AUTHORITY_DECISION_RECORDED", "task_scoped_authority_decision", decision.decisionId, decision, timestamp(2_000));
    ledger.append("PERMISSION_GRANTED", "permission_lease", issuedLease.id, {
      authoritySha256: issuedLease.authoritySha256,
      subject: issuedLease.authority.subject,
      workContract: issuedLease.authority.workContract,
    }, issuedLease.startsAt);

    const execution = createAgentExecutionIdentity({
      executionId,
      profile: profileV1,
      contract,
      authorityLease: issuedLease,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      runtime: {
        provider: "VERCEL_AI_GATEWAY",
        modelId: "provider-selected-tool-capable-model",
        sandboxProvider: "VERCEL_SANDBOX",
      },
      startedAt: timestamp(3_000),
    });
    ledger.append("AGENT_EXECUTION_IDENTITY_CREATED", "agent_execution_identity", execution.executionId, execution, execution.startedAt);
    ledger.append("IDENTITY_BINDING_VERIFIED", "agent_identity", profileV1.agentId, {
      agent: execution.agent,
      workContract: execution.workContract,
      authority: execution.authority,
      executionId: execution.executionId,
    }, execution.startedAt);

    const receiptBinding = {
      agent: agentIdentityReceiptBinding(profileV1),
      executionId: execution.executionId,
      executionSha256: execution.executionSha256,
    };
    assertReceiptIdentityBinding({ receiptBinding, execution });

    const profileV2 = registry.revise(profileV1.agentId, 1, {
      displayName: "DoneLayer Verified Work Agent",
    }, timestamp(4_000));
    ledger.append("AGENT_PROFILE_REVISION_CREATED", "agent_identity_profile", `${profileV2.agentId}:${profileV2.revision}`, profileV2, profileV2.updatedAt);
    const profileV3 = registry.revise(profileV2.agentId, 2, { status: "DISABLED" }, timestamp(5_000));
    ledger.append("AGENT_PROFILE_REVISION_CREATED", "agent_identity_profile", `${profileV3.agentId}:${profileV3.revision}`, profileV3, profileV3.updatedAt);

    const alternate = registry.register(createAgentIdentityProfile({
      displayName: "Alternate Gate Agent",
      controller: profileV1.controller,
      createdAt: timestamp(500),
    }));
    const alternateContract = createAdditionSemanticContract({
      taskId: `agent-identity-alternate-${randomUUID()}`,
      branch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
      commitSha: FIXTURE_COMMIT,
      assignedAgent: agentIdentityReference(alternate),
      lockedAt: timestamp(1_100),
    });
    const alternateExecutionId = generateExecutionId();
    const alternateLease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({
      contract: alternateContract,
      subject: {
        agentId: alternate.agentId,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        jobRunId: randomUUID(),
        agentIdentity: agentIdentityReference(alternate),
        executionId: alternateExecutionId,
      },
      decidedAt: timestamp(2_100),
    }));
    const alternateExecution = createAgentExecutionIdentity({
      executionId: alternateExecutionId,
      profile: alternate,
      contract: alternateContract,
      authorityLease: alternateLease,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      runtime: { provider: "VERCEL_AI_GATEWAY", modelId: null, sandboxProvider: null },
      startedAt: timestamp(3_100),
    });

    const deniedProbes: IdentityDeniedProbe[] = [];
    const deny = (id: string, operation: () => void, offset: number) => {
      try {
        operation();
      } catch (error) {
        const probe = { id, decision: "DENIED" as const, reason: error instanceof Error ? error.message : String(error), recordedAt: timestamp(offset) };
        deniedProbes.push(probe);
        ledger.append("IDENTITY_BINDING_DENIED", "identity_negative_probe", id, probe, probe.recordedAt);
        return;
      }
      throw new Error(`AGENT_IDENTITY_NEGATIVE_PROBE_FAILED:${id}`);
    };
    deny("unknown-agent", () => { registry.current(`agt_${"Z".repeat(24)}`); }, 5_100);
    deny("wrong-agent-work-contract", () => {
      createAgentExecutionIdentity({
        profile: alternate,
        contract,
        authorityLease: issuedLease,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        runtime: { provider: "VERCEL_AI_GATEWAY", modelId: null, sandboxProvider: null },
        startedAt: timestamp(5_200),
      });
    }, 5_200);
    deny("wrong-agent-permission-lease", () => {
      createAgentExecutionIdentity({
        profile: profileV1,
        contract: alternateContract,
        authorityLease: alternateLease,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        runtime: { provider: "VERCEL_AI_GATEWAY", modelId: null, sandboxProvider: null },
        startedAt: timestamp(5_300),
      });
    }, 5_300);
    deny("execution-binding-mismatch", () => {
      assertAgentExecutionBinding({ execution: alternateExecution, contract, authorityLease: issuedLease });
    }, 5_400);
    deny("receipt-agent-rebinding", () => {
      assertReceiptIdentityBinding({
        receiptBinding: { ...receiptBinding, agent: agentIdentityReceiptBinding(alternate) },
        execution,
      });
    }, 5_500);
    deny("disabled-agent-new-execution", () => {
      createAgentExecutionIdentity({
        profile: profileV3,
        contract,
        authorityLease: issuedLease,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        runtime: { provider: "VERCEL_AI_GATEWAY", modelId: null, sandboxProvider: null },
        startedAt: timestamp(5_600),
      });
    }, 5_600);
    deny("malformed-external-identifier", () => {
      createExternalIdentityReference({
        system: "ERC_8004",
        namespace: "eip155:not-a-chain:not-an-address",
        network: "testnet",
        identifier: "not-a-token-id",
        verificationLevel: "DECLARED",
        verificationMethod: null,
        evidenceSha256: null,
        linkedAt: timestamp(5_700),
        verifiedAt: null,
      });
    }, 5_700);
    deny("conflicting-external-linkage", () => {
      registry.linkExternalIdentity(alternate.agentId, alternate.revision, profileV1.externalIdentities[0]!, timestamp(5_800));
    }, 5_800);
    deny("declared-is-not-verified", () => { assertExternalIdentityVerified(profileV1.externalIdentities[0]!); }, 5_900);
    deny("tampered-profile", () => {
      const tampered = structuredClone(profileV1);
      tampered.displayName = "Rewritten historical identity";
      assertAgentIdentityProfileIntegrity(tampered);
    }, 6_000);

    const historical = registry.revision(profileV1.agentId, 1);
    assertReceiptIdentityBinding({
      receiptBinding: { ...receiptBinding, agent: agentIdentityReceiptBinding(historical) },
      execution,
    });
    const finalLease = revokeTaskScopedPermissionLease({
      lease: issuedLease,
      revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
      reason: "Agent Identity V1 Gate completed without external execution",
      revokedAt: timestamp(7_000),
    });
    ledger.append("PERMISSION_LEASE_REVOKED", "permission_lease", finalLease.id, {
      authoritySha256: finalLease.authoritySha256,
      status: finalLease.status,
      reason: finalLease.revocationReason,
    }, finalLease.revokedAt!);

    const profiles = [profileV1, profileV2, profileV3];
    const preReceipt = ledger.verify();
    const receiptId = randomUUID();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const document: AgentIdentityGateReceipt = {
      schemaVersion: 1,
      receiptType: "AGENT_IDENTITY_INTEROPERABILITY_VERIFICATION",
      publicReceiptId,
      gate: AGENT_IDENTITY_GATE,
      finalResult: "IDENTITY_VERIFIED",
      identity: {
        agent: receiptBinding.agent,
        profileHistory: profiles.map((profile) => ({
          revision: profile.revision,
          profileSha256: profile.profileSha256,
          previousProfileSha256: profile.previousProfileSha256,
          displayName: profile.displayName,
          status: profile.status,
        })),
        latestProfileRevision: profileV3.revision,
        latestProfileSha256: profileV3.profileSha256,
      },
      workContract: {
        id: contract.taskId,
        version: contract.contractVersion,
        sha256: contract.workContractSha256,
        assignedAgent: contract.assignedAgent!,
      },
      authority: {
        leaseId: finalLease.id,
        version: finalLease.version,
        authoritySha256: finalLease.authoritySha256,
        subject: finalLease.authority.subject,
        terminalStatus: "REVOKED",
      },
      execution,
      externalIdentityAdapters: {
        mode: "TYPED_REFERENCES_ONLY",
        references: profileV1.externalIdentities,
        liveExternalProofPerformed: false,
        chainRequired: false,
      },
      deniedProbes,
      evidenceLedger: preReceipt,
      issuedAt: timestamp(8_000),
    };
    const receiptSha256 = sha256Canonical(document);
    ledger.append("RECEIPT_CREATED", "job_receipt", receiptId, {
      receiptSha256,
      evidenceChainSha256: preReceipt.chainSha256,
    }, document.issuedAt);
    const outcome: AgentIdentityGateOutcome = {
      gate: AGENT_IDENTITY_GATE,
      status: "IDENTITY_VERIFIED",
      profiles,
      contract,
      issuedLease,
      finalLease,
      execution,
      deniedProbes,
      liveExternalProof: {
        performed: false,
        reason: "V1 proves local identity bindings and typed adapters; no external registration or linkage verification was required.",
      },
      ledgerEntries: ledger.entries,
      ledgerVerification: ledger.verify(),
      receipt: {
        id: receiptId,
        publicReceiptId,
        result: "IDENTITY_VERIFIED",
        receiptSha256,
        evidenceChainSha256: preReceipt.chainSha256!,
        document,
      },
    };
    assertAgentIdentityGateReceiptIntegrity(outcome);
    return outcome;
  }
}

export function assertAgentIdentityGateReceiptIntegrity(outcome: AgentIdentityGateOutcome): void {
  if (outcome.gate !== AGENT_IDENTITY_GATE || outcome.status !== "IDENTITY_VERIFIED") {
    throw new Error("AGENT_IDENTITY_GATE_OUTCOME_INVALID");
  }
  outcome.profiles.forEach(assertAgentIdentityProfileIntegrity);
  for (let index = 1; index < outcome.profiles.length; index += 1) {
    const previous = outcome.profiles[index - 1]!;
    const current = outcome.profiles[index]!;
    if (
      current.agentId !== previous.agentId ||
      current.revision !== previous.revision + 1 ||
      current.previousProfileSha256 !== previous.profileSha256
    ) throw new Error("AGENT_IDENTITY_PROFILE_HISTORY_INVALID");
  }
  assertAgentExecutionBinding({
    execution: outcome.execution,
    contract: outcome.contract,
    authorityLease: outcome.issuedLease,
  });
  assertReceiptIdentityBinding({
    receiptBinding: {
      agent: outcome.receipt.document.identity.agent,
      executionId: outcome.receipt.document.execution.executionId,
      executionSha256: outcome.receipt.document.execution.executionSha256,
    },
    execution: outcome.execution,
  });
  if (
    outcome.finalLease.status !== "REVOKED" ||
    outcome.finalLease.authoritySha256 !== outcome.issuedLease.authoritySha256 ||
    outcome.receipt.document.workContract.sha256 !== outcome.contract.workContractSha256 ||
    canonicalJson(outcome.receipt.document.workContract.assignedAgent) !== canonicalJson(outcome.contract.assignedAgent) ||
    outcome.receipt.document.identity.latestProfileSha256 !== outcome.profiles.at(-1)?.profileSha256 ||
    outcome.receipt.document.deniedProbes.length !== outcome.deniedProbes.length ||
    outcome.deniedProbes.length !== 10 ||
    outcome.receipt.document.externalIdentityAdapters.references.some((reference) => reference.verificationLevel === "VERIFIED") ||
    sha256Canonical(outcome.receipt.document) !== outcome.receipt.receiptSha256
  ) throw new Error("AGENT_IDENTITY_GATE_RECEIPT_TAMPERING_DETECTED");
  const ledger = verifyIdentityLedger(outcome.ledgerEntries);
  const receiptEntry = outcome.ledgerEntries.at(-1);
  if (
    !ledger.valid ||
    canonicalJson(ledger) !== canonicalJson(outcome.ledgerVerification) ||
    receiptEntry?.entryType !== "RECEIPT_CREATED" ||
    receiptEntry.previousEntrySha256 !== outcome.receipt.evidenceChainSha256 ||
    outcome.receipt.document.evidenceLedger.chainSha256 !== outcome.receipt.evidenceChainSha256 ||
    receiptEntry.payloadSha256 !== sha256Canonical({
      receiptSha256: outcome.receipt.receiptSha256,
      evidenceChainSha256: outcome.receipt.evidenceChainSha256,
    })
  ) throw new Error("AGENT_IDENTITY_GATE_LEDGER_INVALID");
}

function gateExternalIdentityReferences(linkedAt: string): ExternalAgentIdentityReference[] {
  return [
    createExternalIdentityReference({
      system: "ERC_8004",
      namespace: "eip155:11155111:0x1111111111111111111111111111111111111111",
      network: "sepolia-test-vector",
      identifier: "42",
      verificationLevel: "DECLARED",
      verificationMethod: null,
      evidenceSha256: null,
      linkedAt,
      verifiedAt: null,
    }),
    createExternalIdentityReference({
      system: "HOL_UAID",
      namespace: "hcs-14",
      network: "testnet-test-vector",
      identifier: "uaid:hiero:testnet:0.0.12345",
      verificationLevel: "DECLARED",
      verificationMethod: null,
      evidenceSha256: null,
      linkedAt,
      verifiedAt: null,
    }),
  ];
}

class IdentityLedger {
  readonly entries: IdentityLedgerEntry[] = [];

  append(entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt: string): void {
    const previousEntrySha256 = this.entries.at(-1)?.entrySha256 ?? null;
    const entry: IdentityLedgerEntry = {
      id: randomUUID(),
      sequenceNumber: this.entries.length + 1,
      entryType,
      sourceRecordType,
      sourceRecordId,
      payloadSha256: sha256Canonical(payload),
      previousEntrySha256,
      entrySha256: "",
      createdAt,
    };
    entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
    this.entries.push(entry);
  }

  verify(): AgentIdentityGateOutcome["ledgerVerification"] {
    return verifyIdentityLedger(this.entries);
  }
}

function verifyIdentityLedger(entries: IdentityLedgerEntry[]): AgentIdentityGateOutcome["ledgerVerification"] {
  let previous: string | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (
      entry.sequenceNumber !== index + 1 ||
      entry.previousEntrySha256 !== previous ||
      entry.entrySha256 !== computeEvidenceLedgerEntryHash(entry)
    ) return { valid: false, entryCount: entries.length, chainSha256: previous };
    previous = entry.entrySha256;
  }
  return { valid: true, entryCount: entries.length, chainSha256: previous };
}
