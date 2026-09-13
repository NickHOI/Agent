import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DemoStore,
  agentIdentityReference,
  assertAgentIdentityProfileIntegrity,
  createExternalIdentityReference,
} from "@donelayer/database";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const evidencePath = path.join(resultDirectory, "agent-identity-durable-productization-v1-evidence.json");
const databasePath = path.join(resultDirectory, "agent-identity-durable-productization-v1.sqlite");
const persistEvidence = process.env.RUN_AGENT_IDENTITY_DURABLE_EVIDENCE_GATE === "true";
const existingEvidence = existsSync(evidencePath) && existsSync(databasePath);
const acceptedEvidenceSha256 = "01457d072734d17603faf2c21e60f57a2d8ff1bd01af2fe46403bf69b6555973";
const acceptedDatabaseSha256 = "b42579fbbf0819c699efdd5d8031d68b530b1919a339934d88be95f611a9e86d";

const sourceFiles = [
  "packages/database/src/agent-identity.ts",
  "packages/database/src/demo-store.ts",
  "packages/database/src/schema.ts",
  "apps/web/src/server/agent-identity/agent-identity.ts",
  "apps/web/src/server/agent-identity/agent-trust-profile.ts",
  "apps/web/src/server/agent-identity/marketplace-agent-identity.ts",
  "apps/web/src/app/api/agents/route.ts",
  "apps/web/src/app/api/agents/[agentId]/identity/route.ts",
  "apps/web/src/app/api/agents/[agentId]/identity/external-identities/route.ts",
  "apps/web/src/app/provider/agents/page.tsx",
  "apps/web/src/app/agents/[slug]/page.tsx",
  "tests/unit/agent-identity-persistence.test.ts",
  "tests/unit/agent-trust-profile.test.ts",
] as const;

describe("Agent Identity durable productization V1 evidence", () => {
  it("persists a restart-verifiable profile chain and negative SQL evidence", async () => {
    if (persistEvidence && existingEvidence) {
      throw new Error("Accepted Agent Identity durable evidence is immutable and cannot be regenerated in place.");
    }
    const temporaryRoot = persistEvidence
      ? resultDirectory
      : await mkdtemp(path.join(tmpdir(), "donelayer-identity-evidence-"));
    const targetDatabasePath = persistEvidence ? databasePath : path.join(temporaryRoot, "identity.sqlite");
    if (persistEvidence) {
      await mkdir(resultDirectory, { recursive: true });
      await Promise.all([
        rm(evidencePath, { force: true }),
        rm(databasePath, { force: true }),
        rm(`${databasePath}-wal`, { force: true }),
        rm(`${databasePath}-shm`, { force: true }),
      ]);
    }

    const store = new DemoStore(targetDatabasePath);
    const agent = store.createAgent({
      providerId: "provider-alpha",
      providerName: "Provider Alpha",
      name: "Durable Identity Product Agent",
      slug: "durable-identity-product-agent",
      description: "A local productization evidence Agent for restart-safe identity profile persistence.",
      skills: ["Agent Identity", "TypeScript"],
      taskTypes: ["FEATURE_COMPLETION"],
      languages: ["TypeScript"],
      operatingSystems: ["LINUX"],
      tools: ["Git", "Node.js"],
      requiredMcpServers: [],
      pricingModel: "FIXED",
      basePriceCents: 25_000,
      endpointType: "LOCAL_WORKER",
      endpointUrl: null,
      authenticationType: "NONE",
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    });
    const profileV1 = store.getAgentIdentityProfile(agent.id)!;
    const profileV2 = store.reviseAgentIdentity({
      agentId: agent.id,
      expectedRevision: 1,
      patch: { declaredCapabilities: [...profileV1.declaredCapabilities, "durable-profile-history"] },
      updatedAt: after(profileV1.updatedAt, 1_000),
    });
    const external = createExternalIdentityReference({
      system: "HOL_UAID",
      namespace: "hcs-14",
      network: "testnet",
      identifier: "uaid:durable-productization-evidence",
      verificationLevel: "DECLARED",
      verificationMethod: null,
      evidenceSha256: null,
      linkedAt: after(profileV2.updatedAt, 500),
      verifiedAt: null,
    });
    const profileV3 = store.linkAgentExternalIdentity({
      agentId: agent.id,
      expectedRevision: 2,
      reference: external,
      updatedAt: after(profileV2.updatedAt, 1_000),
    });
    const database = databaseOf(store);
    const deniedProbes = [
      captureDenied(() => database.prepare(
        "UPDATE agent_identity_profiles SET profile_json='{}' WHERE agent_id=? AND revision=1",
      ).run(agent.id)),
      captureDenied(() => database.prepare(
        "DELETE FROM agent_identity_profiles WHERE agent_id=? AND revision=1",
      ).run(agent.id)),
      captureDenied(() => store.reviseAgentIdentity({
        agentId: agent.id,
        expectedRevision: 1,
        patch: { displayName: "Stale overwrite" },
      })),
      captureDenied(() => store.linkAgentExternalIdentity({
        agentId: agent.id,
        expectedRevision: 3,
        reference: external,
      })),
    ];
    const beforeRestart = store.verifyAgentIdentityStore();
    store.close();

    const reopened = new DemoStore(targetDatabasePath);
    const history = reopened.listAgentIdentityHistory(agent.id);
    const afterRestart = reopened.verifyAgentIdentityStore();
    reopened.close();

    expect(deniedProbes.every((probe) => probe.denied)).toBe(true);
    expect(beforeRestart.valid).toBe(true);
    expect(afterRestart.valid).toBe(true);
    expect(history).toEqual([profileV1, profileV2, profileV3]);
    history.forEach(assertAgentIdentityProfileIntegrity);

    if (persistEvidence) {
      const evidence = {
        gate: "AGENT_IDENTITY_DURABLE_PRODUCTIZATION_V1",
        capturedAt: new Date().toISOString(),
        job: {
          jobId: "phase3-agent-identity-durable-productization-v1",
          task: "Persist Marketplace Agent identity revisions atomically and expose controlled identity API/UX.",
          independentlyNeededWithoutReputation: true,
          sourceRequirement: [
            "docs/PRODUCT_ROADMAP.md Phase 3 durable platform identity/profile layer",
            "CURRENT_ARCHITECTURE.md in-process registry limitation",
            "IMPLEMENTATION_STATUS.md production persistence/API/UX gap",
          ],
          preliminaryClassification: "NOT_VERIFIED",
          classificationReason: "Engineering verification passed, but no full current Agent Job trust lifecycle or Verified Job Receipt executed this delivery.",
          canonicalCountContribution: 0,
        },
        proofBoundary: {
          localSqlitePersistence: true,
          productionPersistenceClaimed: false,
          fullAgentJobLifecycleExecuted: false,
          verifiedJobReceiptCreated: false,
          externalIdentityVerificationPerformed: false,
          externalReadPerformed: false,
          externalWritePerformed: false,
          modelCalls: 0,
          sandboxes: 0,
          paymentPerformed: false,
          deploymentPerformed: false,
        },
        sourceFiles: sourceFiles.map((relativePath) => ({
          path: relativePath,
          sha256: fileSha256(path.join(workspaceRoot, relativePath)),
        })),
        identity: {
          agentId: agent.id,
          revisions: history.map(agentIdentityReference),
          controllerAssurance: profileV3.controller.assurance,
          legallyVerified: profileV3.controller.legallyVerified,
          externalIdentityVerificationLevels: profileV3.externalIdentities.map((item) => item.verificationLevel),
        },
        verification: {
          beforeRestart,
          afterRestart,
          deniedProbes,
          historyLength: history.length,
          historicalHashesUnchanged: history[1]?.previousProfileSha256 === history[0]?.profileSha256 &&
            history[2]?.previousProfileSha256 === history[1]?.profileSha256,
        },
      };
      const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
      expect(serialized).not.toMatch(secretPattern());
      await writeFile(evidencePath, serialized, "utf8");
    } else {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!persistEvidence && !existingEvidence)("verifies accepted artifacts and persisted profile history offline", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      sourceFiles: Array<{ path: string; sha256: string }>;
      identity: { agentId: string; revisions: Array<{ profileSha256: string }> };
      verification: { afterRestart: { valid: boolean }; deniedProbes: Array<{ denied: boolean }> };
    };
    const store = new DemoStore(databasePath);
    const history = store.listAgentIdentityHistory(evidence.identity.agentId);
    const verification = store.verifyAgentIdentityStore();
    store.close();

    expect(verification.valid).toBe(true);
    expect(evidence.verification.afterRestart.valid).toBe(true);
    expect(evidence.verification.deniedProbes.every((probe) => probe.denied)).toBe(true);
    expect(fileSha256(evidencePath)).toBe(acceptedEvidenceSha256);
    expect(fileSha256(databasePath)).toBe(acceptedDatabaseSha256);
    expect(history.map((profile) => profile.profileSha256)).toEqual(
      evidence.identity.revisions.map((reference) => reference.profileSha256),
    );
    expect(evidence.sourceFiles.every((file) => (
      existsSync(path.join(workspaceRoot, file.path)) && /^[a-f0-9]{64}$/.test(file.sha256)
    ))).toBe(true);
  });
});

function databaseOf(store: DemoStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}

function captureDenied(operation: () => unknown): { denied: boolean; reason: string } {
  try {
    operation();
    return { denied: false, reason: "UNEXPECTEDLY_ALLOWED" };
  } catch (error) {
    return { denied: true, reason: error instanceof Error ? error.message : "UNKNOWN_ERROR" };
  }
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function after(timestamp: string, milliseconds: number): string {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function secretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i;
}
