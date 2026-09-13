import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DemoStore,
  canonicalJson,
  parseTaskContractDocument,
  sha256Canonical,
  type TaskContractDocument,
} from "@donelayer/database";

const stores: DemoStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Task Contract v1", () => {
  it("uses canonical content hashes independent of object key insertion order", () => {
    const first = {
      desiredOutcome: "Produce a verified artifact.",
      taskType: "WORKER_SMOKE_V1",
      nested: { z: 3, a: 1 },
      deliverables: ["hello.txt"],
    };
    const reordered = {
      deliverables: ["hello.txt"],
      nested: { a: 1, z: 3 },
      taskType: "WORKER_SMOKE_V1",
      desiredOutcome: "Produce a verified artifact.",
    };

    expect(canonicalJson(first)).toBe(canonicalJson(reordered));
    expect(sha256Canonical(first)).toBe(sha256Canonical(reordered));
    expect(sha256Canonical({ ...first, desiredOutcome: "Changed" })).not.toBe(
      sha256Canonical(first),
    );
  });

  it("preserves acceptance-check config through validation and persistence", () => {
    const store = createStore();
    const task = store.createDemoTask();
    const input = contractDraft({
      acceptanceChecks: [
        {
          id: "hello-created",
          label: "hello.txt exists",
          required: true,
          type: "FILE_EXISTS",
          config: { path: "hello.txt", exactSize: 128, nested: { encoding: "utf8" } },
        },
      ],
    });

    const draft = store.createTaskContractDraft(task.id, input, "contract-test");
    const parsed = parseTaskContractDocument(structuredClone(draft.contract));

    expect(parsed.acceptanceChecks[0]?.config).toEqual({
      path: "hello.txt",
      exactSize: 128,
      nested: { encoding: "utf8" },
    });
    expect(draft.contractSha256).toBe(sha256Canonical(draft.contract));
    expect(draft.version).toBe(1);
  });

  it("locks immutable content and creates a new monotonically-versioned revision", () => {
    const store = createStore();
    const task = store.createDemoTask();
    const firstDraft = store.createTaskContractDraft(task.id, contractDraft(), "contract-test");
    const firstLocked = store.lockTaskContract(firstDraft.id, "contract-test");

    expect(firstLocked).toMatchObject({ version: 1, status: "LOCKED" });
    expect(firstLocked.lockedAt).toBeTruthy();
    expect(() =>
      store.updateTaskContractDraft(
        firstLocked.id,
        contractDraft({ desiredOutcome: "Mutate locked content." }),
        "contract-test",
      ),
    ).toThrow(/locked.*cannot be modified/i);

    const db = databaseOf(store);
    expect(() =>
      db.prepare("UPDATE task_contract_versions SET contract_json=? WHERE id=?").run(
        canonicalJson({ tampered: true }),
        firstLocked.id,
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      db.prepare("DELETE FROM task_contract_versions WHERE id=?").run(firstLocked.id),
    ).toThrow(/cannot be deleted/i);

    const revision = store.createTaskContractRevision(
      firstLocked.id,
      contractDraft({ desiredOutcome: "Revised desired outcome." }),
      "contract-test",
    );
    expect(revision).toMatchObject({ version: 2, status: "DRAFT" });

    const secondLocked = store.lockTaskContract(revision.id, "contract-test");
    expect(secondLocked).toMatchObject({ version: 2, status: "LOCKED" });
    expect(secondLocked.contractSha256).not.toBe(firstLocked.contractSha256);
    expect(store.getTaskContractVersion(firstLocked.id)).toMatchObject({
      status: "SUPERSEDED",
      supersededAt: expect.any(String),
    });
    expect(store.getLockedTaskContract(task.id)?.id).toBe(secondLocked.id);
  });

  it("rejects malformed required contract fields rather than hashing partial content", () => {
    const valid = fullContract(randomUUID());

    expect(() => parseTaskContractDocument({ ...valid, deliverables: [] })).toThrow();
    expect(() =>
      parseTaskContractDocument({
        ...valid,
        acceptanceChecks: [{ ...valid.acceptanceChecks[0], config: undefined }],
      }),
    ).toThrow();
    expect(() => parseTaskContractDocument({ ...valid, timeLimitSeconds: 0 })).toThrow();
    expect(() => parseTaskContractDocument({ ...valid, unexpected: "field" })).toThrow();
  });

  it("adds the Task Contract reference column when opening a legacy SQLite file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "donelayer-legacy-db-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO profiles VALUES ('legacy-profile','Legacy','ADMIN','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z');
      CREATE TABLE job_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        executor TEXT NOT NULL,
        workflow_template TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        exit_code INTEGER,
        commit_sha_before TEXT,
        commit_sha_after TEXT,
        lease_id TEXT,
        lease_token_hash TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const migrated = new DemoStore(databasePath);
    stores.push(migrated);
    const columns = databaseOf(migrated)
      .prepare("PRAGMA table_info(job_runs)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain("task_contract_version_id");
  });
});

function createStore(): DemoStore {
  const store = new DemoStore(":memory:");
  stores.push(store);
  return store;
}

function databaseOf(store: DemoStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}

function contractDraft(
  overrides: Partial<Omit<TaskContractDocument, "taskId" | "contractVersion">> = {},
): Omit<TaskContractDocument, "taskId" | "contractVersion"> {
  return {
    taskType: "WORKER_SMOKE_V1",
    desiredOutcome: "Prove that an independent Worker produced a verified artifact.",
    deliverables: ["hello.txt"],
    allowedWorkflow: "WORKER_SMOKE_V1",
    allowedActions: ["write_hello_txt", "calculate_sha256", "upload_artifact"],
    forbiddenActions: ["network_access", "arbitrary_shell"],
    acceptanceChecks: [
      {
        id: "hello-created",
        label: "hello.txt exists",
        required: true,
        type: "FILE_EXISTS",
        config: { path: "hello.txt" },
      },
    ],
    requiredEvidence: ["hello.txt", "server SHA-256"],
    budgetLimit: { currency: "USD", maxAmount: 0 },
    timeLimitSeconds: 60,
    privacyClassification: "INTERNAL",
    humanApprovalRequirements: [],
    failureConditions: ["Artifact hash mismatch"],
    ...overrides,
  };
}

function fullContract(taskId: string): TaskContractDocument {
  return { ...contractDraft(), taskId, contractVersion: 1 };
}
