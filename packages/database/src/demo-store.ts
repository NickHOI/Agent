import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { rankCandidates } from "@donelayer/matching";
import { evaluateProofOfDone, getEvidenceDigest } from "@donelayer/proof-of-done";
import {
  createTaskInputSchema,
  type Actor,
  type CreateTaskInput,
  type EvidenceInput,
  type TaskAnalysis,
  type TaskStatus
} from "@donelayer/shared";
import { validateTransition } from "@donelayer/task-state-machine";
import { demoAcceptanceChecks, createSeedAgents, createSeedWorkers } from "./seed-data";
import { demoSchemaSql } from "./schema";
import type {
  AgentRecord,
  AssignmentRecord,
  AuditLogRecord,
  DashboardSnapshot,
  DisputeRecord,
  EvidenceArtifactRecord,
  JobEventRecord,
  JobRunRecord,
  LedgerEntryRecord,
  MatchRecord,
  ProfileRecord,
  TaskAggregate,
  TaskEventRecord,
  TaskRecord,
  VerificationResultRecord,
  WalletRecord,
  WorkerRecord
} from "./types";

type SqlRow = Record<string, unknown>;

const CUSTOMER_ID = "customer-nick";
const PROVIDER_ALPHA_ID = "provider-alpha";
const PLATFORM_ID = "platform";
const ESCROW_ID = "escrow";

function now(): string {
  return new Date().toISOString();
}

function workspaceRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string };
        if (manifest.name === "donelayer") return current;
      } catch {
        // Keep walking toward the workspace root.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function resolveDatabasePath(configured?: string): string {
  if (configured === ":memory:") return configured;
  const value = configured ?? process.env.DEMO_DATABASE_PATH ?? ".data/donelayer.sqlite";
  return resolve(workspaceRoot(), value);
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") throw new Error("Expected a JSON database column.");
  return JSON.parse(value) as T;
}

function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

function number(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expected a numeric database column.");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a text database column.");
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function pairingPepper(): string {
  return process.env.DEMO_SESSION_SECRET ?? "donelayer-local-pairing-pepper-not-for-production";
}

function pairingDigest(code: string): string {
  return createHmac("sha256", pairingPepper()).update(code.toUpperCase()).digest("hex");
}

function workerTokenDigest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function demoTaskInput(): CreateTaskInput {
  return createTaskInputSchema.parse({
    title: "Fix failing authentication tests in a sample repository",
    problemDescription: "Authentication tests fail after the session timeout logic was changed. Diagnose the repository and repair only the scoped test and session implementation.",
    desiredOutcome: "All authentication tests pass, the production build succeeds and an evidence pack shows the exact diff and test counts.",
    repository: "demo://sample-org/react-auth",
    targetBranch: "main",
    taskType: "TEST_AND_FIX",
    requiredSkills: ["React", "TypeScript", "Authentication"],
    requiredOperatingSystem: "WINDOWS",
    requiredTools: ["Git", "Node.js", "npm"],
    requiredMcpTools: [],
    budgetCents: 24000,
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptanceChecks: demoAcceptanceChecks,
    securitySensitivity: "MEDIUM",
    allowCodeChanges: true,
    allowPullRequest: true,
    requiresHumanApproval: true,
    preferredAgentId: null
  });
}

function analyzeTask(input: CreateTaskInput): TaskAnalysis {
  const suggestedBudgetCents = Math.max(12000, Math.round(input.budgetCents * 0.9));
  return {
    scopeSummary: `Repair the scoped ${input.taskType.toLowerCase().replaceAll("_", " ")} task in ${input.repository} without expanding repository access.`,
    requiredCapabilities: [...new Set([...input.requiredSkills, ...input.requiredTools])],
    suggestedTaskTemplate: input.taskType,
    riskLevel: input.securitySensitivity,
    suggestedVerificationChecks: input.acceptanceChecks,
    suggestedBudgetCents,
    estimatedDurationHours: input.taskType === "FEATURE_COMPLETION" ? 12 : 6
  };
}

function mapAgent(row: SqlRow): AgentRecord {
  const data = parseJson<AgentRecord>(row.data_json);
  return { ...data, id: string(row.id), slug: string(row.slug), providerId: string(row.provider_id), createdAt: string(row.created_at), updatedAt: string(row.updated_at) };
}

function mapWorker(row: SqlRow): WorkerRecord {
  const data = parseJson<WorkerRecord>(row.data_json);
  return {
    ...data,
    id: string(row.id),
    providerId: string(row.provider_id),
    status: string(row.status) as WorkerRecord["status"],
    tokenHash: nullableString(row.token_hash),
    tokenId: nullableString(row.token_id),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapTask(row: SqlRow): TaskRecord {
  const data = parseJson<TaskRecord>(row.data_json);
  return {
    ...data,
    id: string(row.id),
    customerId: string(row.customer_id),
    status: string(row.status) as TaskStatus,
    version: number(row.version),
    matchedAgentId: nullableString(row.matched_agent_id),
    assignedWorkerId: nullableString(row.assigned_worker_id),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapTaskEvent(row: SqlRow): TaskEventRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    sequence: number(row.sequence),
    fromStatus: nullableString(row.from_status) as TaskStatus | null,
    toStatus: string(row.to_status) as TaskStatus,
    actorKind: string(row.actor_kind),
    actorId: string(row.actor_id),
    reason: string(row.reason),
    eventType: string(row.event_type),
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: string(row.created_at)
  };
}

function mapMatch(row: SqlRow): MatchRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    agentId: string(row.agent_id),
    workerId: string(row.worker_id),
    rank: number(row.rank),
    totalScore: number(row.total_score),
    eligible: bool(row.eligible),
    components: parseJson<Record<string, number>>(row.components_json),
    reasons: parseJson<string[]>(row.reasons_json),
    createdAt: string(row.created_at)
  };
}

function mapAssignment(row: SqlRow): AssignmentRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    agentId: string(row.agent_id),
    providerId: string(row.provider_id),
    workerId: string(row.worker_id),
    status: string(row.status) as AssignmentRecord["status"],
    quoteCents: number(row.quote_cents),
    providerEarningCents: number(row.provider_earning_cents),
    platformFeeCents: number(row.platform_fee_cents),
    acceptedAt: nullableString(row.accepted_at),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapJobRun(row: SqlRow): JobRunRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    assignmentId: string(row.assignment_id),
    workerId: string(row.worker_id),
    agentId: string(row.agent_id),
    status: string(row.status) as JobRunRecord["status"],
    executor: string(row.executor) as JobRunRecord["executor"],
    workflowTemplate: string(row.workflow_template) as JobRunRecord["workflowTemplate"],
    startedAt: nullableString(row.started_at),
    endedAt: nullableString(row.ended_at),
    exitCode: typeof row.exit_code === "number" ? row.exit_code : null,
    commitShaBefore: nullableString(row.commit_sha_before),
    commitShaAfter: nullableString(row.commit_sha_after),
    leaseId: nullableString(row.lease_id),
    leaseTokenHash: nullableString(row.lease_token_hash),
    leaseExpiresAt: nullableString(row.lease_expires_at),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapJobEvent(row: SqlRow): JobEventRecord {
  return {
    id: string(row.id),
    jobRunId: string(row.job_run_id),
    sequence: number(row.sequence),
    kind: string(row.kind) as JobEventRecord["kind"],
    level: string(row.level) as JobEventRecord["level"],
    message: string(row.message),
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: string(row.created_at)
  };
}

function mapArtifact(row: SqlRow): EvidenceArtifactRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    workerId: string(row.worker_id),
    jobRunId: string(row.job_run_id),
    artifactType: string(row.artifact_type),
    fileName: string(row.file_name),
    mimeType: string(row.mime_type),
    size: number(row.size),
    sha256: string(row.sha256),
    storagePath: string(row.storage_path),
    content: string(row.content),
    createdAt: string(row.created_at)
  };
}

function mapVerification(row: SqlRow): VerificationResultRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    jobRunId: string(row.job_run_id),
    checkId: string(row.check_id),
    checkType: string(row.check_type),
    status: string(row.status) as VerificationResultRecord["status"],
    summary: string(row.summary),
    observed: parseJson<Record<string, unknown>>(row.observed_json),
    createdAt: string(row.created_at)
  };
}

function mapWallet(row: SqlRow): WalletRecord {
  return {
    id: string(row.id),
    ownerId: string(row.owner_id),
    kind: string(row.kind) as WalletRecord["kind"],
    availableCents: number(row.available_cents),
    reservedCents: number(row.reserved_cents),
    pendingCents: number(row.pending_cents),
    updatedAt: string(row.updated_at)
  };
}

function mapLedger(row: SqlRow): LedgerEntryRecord {
  return {
    id: string(row.id),
    taskId: nullableString(row.task_id),
    walletId: string(row.wallet_id),
    transactionKey: string(row.transaction_key),
    entryType: string(row.entry_type) as LedgerEntryRecord["entryType"],
    amountCents: number(row.amount_cents),
    createdAt: string(row.created_at)
  };
}

function mapDispute(row: SqlRow): DisputeRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    openedBy: string(row.opened_by),
    reason: string(row.reason),
    status: string(row.status) as DisputeRecord["status"],
    heldAmountCents: number(row.held_amount_cents),
    resolution: nullableString(row.resolution),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapAudit(row: SqlRow): AuditLogRecord {
  return {
    id: string(row.id),
    actorKind: string(row.actor_kind),
    actorId: string(row.actor_id),
    action: string(row.action),
    resourceType: string(row.resource_type),
    resourceId: string(row.resource_id),
    success: bool(row.success),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    createdAt: string(row.created_at)
  };
}

export class DemoStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private transactionDepth = 0;

  constructor(databasePath?: string) {
    this.databasePath = resolveDatabasePath(databasePath);
    if (this.databasePath !== ":memory:") mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(demoSchemaSql);
    this.seed();
    this.reconcileWorkerCapacity();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private rows(sql: string, ...parameters: Array<string | number | null>): SqlRow[] {
    return this.db.prepare(sql).all(...parameters) as SqlRow[];
  }

  private row(sql: string, ...parameters: Array<string | number | null>): SqlRow | undefined {
    return this.db.prepare(sql).get(...parameters) as SqlRow | undefined;
  }

  private seed(): void {
    const existing = this.row("SELECT id FROM profiles LIMIT 1");
    if (existing) return;
    const timestamp = now();
    this.transaction(() => {
      const profiles = [
        [CUSTOMER_ID, "Nick Demo", "CUSTOMER"],
        [PROVIDER_ALPHA_ID, "Provider Alpha", "PROVIDER"],
        ["provider-beta", "Provider Beta", "PROVIDER"],
        ["admin-demo", "DoneLayer Admin", "ADMIN"]
      ] as const;
      const insertProfile = this.db.prepare("INSERT INTO profiles(id,name,role,created_at,updated_at) VALUES(?,?,?,?,?)");
      for (const profile of profiles) insertProfile.run(profile[0], profile[1], profile[2], timestamp, timestamp);

      const insertAgent = this.db.prepare("INSERT INTO agents(id,slug,provider_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)");
      for (const agent of createSeedAgents(timestamp)) {
        insertAgent.run(agent.id, agent.slug, agent.providerId, JSON.stringify(agent), timestamp, timestamp);
      }

      const insertWorker = this.db.prepare("INSERT INTO worker_nodes(id,provider_id,status,token_hash,token_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
      for (const worker of createSeedWorkers(timestamp)) {
        insertWorker.run(worker.id, worker.providerId, worker.status, null, null, JSON.stringify(worker), timestamp, timestamp);
      }

      const wallets = [
        ["wallet-customer", CUSTOMER_ID, "CUSTOMER", 2500000],
        ["wallet-provider-alpha", PROVIDER_ALPHA_ID, "PROVIDER", 624000],
        ["wallet-platform", PLATFORM_ID, "PLATFORM", 188000],
        ["wallet-escrow", ESCROW_ID, "ESCROW", 0],
        ["wallet-dispute", "dispute", "DISPUTE", 0]
      ] as const;
      const insertWallet = this.db.prepare("INSERT INTO test_wallets(id,owner_id,kind,available_cents,reserved_cents,pending_cents,created_at,updated_at) VALUES(?,?,?,?,0,0,?,?)");
      for (const wallet of wallets) insertWallet.run(wallet[0], wallet[1], wallet[2], wallet[3], timestamp, timestamp);
    });

    const sample = this.createTask(demoTaskInput(), CUSTOMER_ID, "10000000-0000-4000-8000-000000000001");
    let current = sample;
    for (let step = 0; step < 20 && current.status !== "CUSTOMER_REVIEW"; step += 1) {
      current = this.advanceDemo(current.id).task;
    }
    const offerInput = demoTaskInput();
    offerInput.title = "Diagnose a failing checkout build";
    offerInput.problemDescription = "A demo checkout application no longer builds after a dependency update. Identify the bounded dependency or configuration failure and provide a launch-readiness report.";
    offerInput.desiredOutcome = "The root cause is documented, the approved build workflow exits successfully and the changed files are recorded.";
    offerInput.repository = "demo://sample-org/checkout-web";
    offerInput.taskType = "BUILD_RESCUE";
    offerInput.requiredSkills = ["React", "TypeScript"];
    const offered = this.createTask(offerInput, CUSTOMER_ID, "10000000-0000-4000-8000-000000000002");
    current = offered;
    for (let step = 0; step < 10 && current.status !== "AWAITING_PROVIDER"; step += 1) {
      current = this.advanceDemo(current.id).task;
    }
  }

  listAgents(): AgentRecord[] {
    return this.rows("SELECT * FROM agents ORDER BY json_extract(data_json, '$.verifiedSuccessRate') DESC").map(mapAgent);
  }

  getAgentById(id: string): AgentRecord | null {
    const found = this.row("SELECT * FROM agents WHERE id = ?", id);
    return found ? mapAgent(found) : null;
  }

  getAgentBySlug(slug: string): AgentRecord | null {
    const found = this.row("SELECT * FROM agents WHERE slug = ?", slug);
    return found ? mapAgent(found) : null;
  }

  listWorkers(providerId?: string): WorkerRecord[] {
    const found = providerId
      ? this.rows("SELECT * FROM worker_nodes WHERE provider_id = ? ORDER BY created_at", providerId)
      : this.rows("SELECT * FROM worker_nodes ORDER BY created_at");
    return found.map(mapWorker);
  }

  getWorker(id: string): WorkerRecord | null {
    const found = this.row("SELECT * FROM worker_nodes WHERE id = ?", id);
    return found ? mapWorker(found) : null;
  }

  listTasks(customerId?: string): TaskRecord[] {
    const found = customerId
      ? this.rows("SELECT * FROM tasks WHERE customer_id = ? ORDER BY updated_at DESC", customerId)
      : this.rows("SELECT * FROM tasks ORDER BY updated_at DESC");
    return found.map(mapTask);
  }

  getTask(id: string): TaskRecord | null {
    const found = this.row("SELECT * FROM tasks WHERE id = ?", id);
    return found ? mapTask(found) : null;
  }

  createTask(inputValue: CreateTaskInput, customerId = CUSTOMER_ID, id = randomUUID()): TaskRecord {
    const input = createTaskInputSchema.parse(inputValue);
    const timestamp = now();
    const task: TaskRecord = {
      id,
      customerId,
      title: input.title,
      problemDescription: input.problemDescription,
      desiredOutcome: input.desiredOutcome,
      repository: input.repository,
      targetBranch: input.targetBranch,
      taskType: input.taskType,
      requiredSkills: input.requiredSkills,
      requiredOperatingSystem: input.requiredOperatingSystem,
      requiredTools: input.requiredTools,
      requiredMcpTools: input.requiredMcpTools,
      budgetCents: input.budgetCents,
      deadline: input.deadline,
      acceptanceChecks: input.acceptanceChecks,
      securitySensitivity: input.securitySensitivity,
      allowCodeChanges: input.allowCodeChanges,
      allowPullRequest: input.allowPullRequest,
      requiresHumanApproval: input.requiresHumanApproval,
      preferredAgentId: input.preferredAgentId,
      status: "DRAFT",
      version: 0,
      analysis: null,
      matchedAgentId: null,
      assignedWorkerId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    return this.transaction(() => {
      this.db.prepare("INSERT INTO tasks(id,customer_id,status,version,matched_agent_id,assigned_worker_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        task.id,
        task.customerId,
        task.status,
        task.version,
        null,
        null,
        JSON.stringify(task),
        timestamp,
        timestamp
      );
      this.insertTaskEvent(task.id, null, "DRAFT", { kind: "CUSTOMER", id: customerId }, "Task draft created", "TASK_CREATED");
      this.reserve(task.id, customerId, task.budgetCents);
      return task;
    });
  }

  createDemoTask(): TaskRecord {
    return this.createTask(demoTaskInput());
  }

  private insertTaskEvent(
    taskId: string,
    fromStatus: TaskStatus | null,
    toStatus: TaskStatus,
    actor: Actor,
    reason: string,
    eventType: string,
    payload: Record<string, unknown> = {}
  ): TaskEventRecord {
    const timestamp = now();
    const sequenceRow = this.row("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM task_events WHERE task_id = ?", taskId);
    const sequence = sequenceRow ? number(sequenceRow.next_sequence) : 1;
    const event: TaskEventRecord = {
      id: randomUUID(),
      taskId,
      sequence,
      fromStatus,
      toStatus,
      actorKind: actor.kind,
      actorId: actor.id,
      reason,
      eventType,
      payload,
      createdAt: timestamp
    };
    this.db.prepare("INSERT INTO task_events(id,task_id,sequence,from_status,to_status,actor_kind,actor_id,reason,event_type,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
      event.id,
      taskId,
      sequence,
      fromStatus,
      toStatus,
      actor.kind,
      actor.id,
      reason,
      eventType,
      JSON.stringify(payload),
      timestamp,
      timestamp
    );
    this.insertAudit(actor, eventType, "task", taskId, payload);
    return event;
  }

  private insertAudit(actor: Actor, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}): void {
    const timestamp = now();
    this.db.prepare("INSERT INTO audit_logs(id,actor_kind,actor_id,action,resource_type,resource_id,success,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)").run(
      randomUUID(),
      actor.kind,
      actor.id,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata),
      timestamp,
      timestamp
    );
  }

  private transitionUnsafe(task: TaskRecord, to: TaskStatus, actor: Actor, reason: string, eventType: string): TaskRecord {
    const assignment = this.getLatestAssignment(task.id);
    const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
    const providerId = assignment?.providerId ?? agent?.providerId;
    const workerId = assignment?.workerId ?? task.assignedWorkerId ?? undefined;
    validateTransition({
      from: task.status,
      to,
      actor,
      reason,
      context: {
        customerId: task.customerId,
        ...(providerId ? { providerId } : {}),
        ...(workerId ? { workerId } : {})
      }
    });
    const timestamp = now();
    this.db.prepare("UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(to, timestamp, task.id, task.version);
    this.insertTaskEvent(task.id, task.status, to, actor, reason, eventType);
    const updated = this.getTask(task.id);
    if (!updated) throw new Error("Task disappeared during transition.");
    return updated;
  }

  transitionTask(taskId: string, to: TaskStatus, actor: Actor, reason: string, eventType = "STATUS_CHANGED"): TaskRecord {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      return this.transitionUnsafe(task, to, actor, reason, eventType);
    });
  }

  private setAnalysis(task: TaskRecord): void {
    const analysis = analyzeTask({
      title: task.title,
      problemDescription: task.problemDescription,
      desiredOutcome: task.desiredOutcome,
      repository: task.repository,
      targetBranch: task.targetBranch,
      taskType: task.taskType,
      requiredSkills: task.requiredSkills,
      requiredOperatingSystem: task.requiredOperatingSystem as "ANY" | "WINDOWS" | "MACOS" | "LINUX" | null,
      requiredTools: task.requiredTools,
      requiredMcpTools: task.requiredMcpTools,
      budgetCents: task.budgetCents,
      deadline: task.deadline,
      acceptanceChecks: task.acceptanceChecks,
      securitySensitivity: task.securitySensitivity,
      allowCodeChanges: task.allowCodeChanges,
      allowPullRequest: task.allowPullRequest,
      requiresHumanApproval: task.requiresHumanApproval,
      preferredAgentId: task.preferredAgentId
    });
    const data = { ...task, analysis };
    this.db.prepare("UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), now(), task.id);
  }

  private matchTask(task: TaskRecord): MatchRecord[] {
    this.reconcileWorkerCapacity();
    const agents = this.listAgents();
    const workers = this.listWorkers();
    const timestamp = now();
    for (const worker of workers.filter((item) => item.status === "ONLINE" || item.status === "BUSY")) {
      const refreshed = { ...worker, lastHeartbeatAt: timestamp, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET data_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(refreshed), timestamp, worker.id);
    }

    const candidates = agents.flatMap((agent) =>
      workers
        .filter((worker) => worker.providerId === agent.providerId)
        .map((worker) => ({
          agent: {
            id: agent.id,
            name: agent.name,
            providerId: agent.providerId,
            providerName: agent.providerName,
            skills: agent.skills,
            taskTypes: agent.taskTypes,
            supportedOperatingSystems: agent.operatingSystems as Array<"ANY" | "WINDOWS" | "MACOS" | "LINUX">,
            supportedTools: agent.tools,
            supportedMcpTools: agent.requiredMcpServers,
            minimumPriceCents: agent.basePriceCents,
            acceptingTasks: agent.acceptingTasks,
            verificationStatus: agent.verificationStatus,
            verifiedSuccessRate: agent.verifiedSuccessRate,
            averageCompletionHours: Math.max(agent.averageCompletionMinutes / 60, 0.1),
            recentFailures: agent.recentFailures,
            recentRuns: Math.max(10, agent.completedTasks)
          },
          worker: {
            id: worker.id,
            status: worker.status,
            operatingSystem: worker.os,
            installedTools: worker.installedTools,
            installedMcpTools: worker.mcpTools,
            lastHeartbeatAt: worker.status === "ONLINE" || worker.status === "BUSY" ? timestamp : worker.lastHeartbeatAt,
            activeJobs: worker.activeJobs,
            maxConcurrentJobs: worker.maxConcurrentJobs
          }
        }))
    );

    const ranked = rankCandidates(
      {
        id: task.id,
        taskType: task.taskType,
        requiredSkills: task.requiredSkills,
        requiredOperatingSystem: task.requiredOperatingSystem as "ANY" | "WINDOWS" | "MACOS" | "LINUX" | null,
        requiredTools: task.requiredTools,
        requiredMcpTools: task.requiredMcpTools,
        budgetCents: task.budgetCents,
        expectedDurationHours: task.analysis?.estimatedDurationHours ?? 6
      },
      candidates,
      { now: new Date(timestamp) }
    );

    this.db.prepare("DELETE FROM task_matches WHERE task_id = ?").run(task.id);
    const insert = this.db.prepare("INSERT INTO task_matches(id,task_id,agent_id,worker_id,rank,total_score,eligible,components_json,reasons_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const records: MatchRecord[] = [];
    ranked.matches.forEach((match, index) => {
      const record: MatchRecord = {
        id: randomUUID(),
        taskId: task.id,
        agentId: match.candidate.agent.id,
        workerId: match.candidate.worker.id,
        rank: index + 1,
        totalScore: match.score,
        components: { ...match.breakdown },
        reasons: [match.reason],
        eligible: true,
        createdAt: timestamp
      };
      insert.run(record.id, record.taskId, record.agentId, record.workerId, record.rank, record.totalScore, 1, JSON.stringify(record.components), JSON.stringify(record.reasons), timestamp, timestamp);
      records.push(record);
    });

    if (task.preferredAgentId) {
      records.sort((left, right) => Number(right.agentId === task.preferredAgentId) - Number(left.agentId === task.preferredAgentId) || left.rank - right.rank);
      records.forEach((record, index) => {
        record.rank = index + 1;
        this.db.prepare("UPDATE task_matches SET rank=? WHERE id=?").run(record.rank, record.id);
      });
    }
    const top = records[0];
    if (!top) throw new Error("No eligible agent matches this task.");
    this.db.prepare("UPDATE tasks SET matched_agent_id = ?, assigned_worker_id = ?, updated_at = ? WHERE id = ?").run(top.agentId, top.workerId, timestamp, task.id);
    return records;
  }

  private getLatestAssignment(taskId: string): AssignmentRecord | null {
    const found = this.row("SELECT * FROM task_assignments WHERE task_id = ? ORDER BY created_at DESC LIMIT 1", taskId);
    return found ? mapAssignment(found) : null;
  }

  private getLatestJob(taskId: string): JobRunRecord | null {
    const found = this.row("SELECT * FROM job_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1", taskId);
    return found ? mapJobRun(found) : null;
  }

  private acceptAssignment(task: TaskRecord): TaskRecord {
    const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
    const match = this.row("SELECT * FROM task_matches WHERE task_id = ? AND rank = 1", task.id);
    if (!agent || !match) throw new Error("Task has no selected match.");
    const workerId = string(match.worker_id);
    const timestamp = now();
    const assignment: AssignmentRecord = {
      id: randomUUID(),
      taskId: task.id,
      agentId: agent.id,
      providerId: agent.providerId,
      workerId,
      status: "ACCEPTED",
      quoteCents: task.budgetCents,
      providerEarningCents: Math.round(task.budgetCents * 0.8),
      platformFeeCents: task.budgetCents - Math.round(task.budgetCents * 0.8),
      acceptedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
      assignment.id,
      assignment.taskId,
      assignment.agentId,
      assignment.providerId,
      assignment.workerId,
      assignment.status,
      assignment.quoteCents,
      assignment.providerEarningCents,
      assignment.platformFeeCents,
      assignment.acceptedAt,
      timestamp,
      timestamp
    );
    const jobId = randomUUID();
    this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED','DEMO',?,?,?)").run(
      jobId,
      task.id,
      assignment.id,
      workerId,
      agent.id,
      task.taskType,
      timestamp,
      timestamp
    );
    return this.transitionUnsafe(task, "ASSIGNED", { kind: "PROVIDER", id: agent.providerId }, "Provider reviewed the scope and accepted the task", "PROVIDER_ACCEPTED");
  }

  private appendJobEvent(jobRunId: string, kind: JobEventRecord["kind"], level: JobEventRecord["level"], message: string, payload: Record<string, unknown> = {}): JobEventRecord {
    const sequenceRow = this.row("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM job_run_events WHERE job_run_id = ?", jobRunId);
    const sequence = sequenceRow ? number(sequenceRow.next_sequence) : 1;
    const timestamp = now();
    const event: JobEventRecord = { id: randomUUID(), jobRunId, sequence, kind, level, message, payload, createdAt: timestamp };
    this.db.prepare("INSERT INTO job_run_events(id,job_run_id,sequence,kind,level,message,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
      event.id,
      jobRunId,
      sequence,
      kind,
      level,
      message.slice(0, 8000),
      JSON.stringify(payload),
      timestamp,
      timestamp
    );
    return event;
  }

  private reconcileWorkerCapacity(workerId?: string): void {
    const timestamp = now();
    const workers = workerId ? [this.getWorker(workerId)].filter((worker): worker is WorkerRecord => worker !== null) : this.listWorkers();
    for (const worker of workers) {
      const activeRow = this.row(
        "SELECT COUNT(*) AS count FROM job_runs WHERE worker_id=? AND status='RUNNING' AND lease_expires_at>?",
        worker.id,
        timestamp
      );
      const activeJobs = activeRow ? number(activeRow.count) : 0;
      const status: WorkerRecord["status"] =
        worker.status === "SUSPENDED" || worker.status === "OFFLINE"
          ? worker.status
          : activeJobs > 0
            ? "BUSY"
            : "ONLINE";
      if (worker.activeJobs === activeJobs && worker.status === status) continue;
      const updated: WorkerRecord = { ...worker, activeJobs, status, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status=?, data_json=?, updated_at=? WHERE id=?").run(status, JSON.stringify(updated), timestamp, worker.id);
    }
  }

  private claimJob(task: TaskRecord): { task: TaskRecord; leaseToken: string } {
    const job = this.getLatestJob(task.id);
    if (!job || job.status !== "QUEUED") throw new Error("No queued job is available.");
    const timestamp = now();
    const leaseId = randomBytes(8).toString("hex");
    const leaseSecret = randomBytes(32).toString("base64url");
    const leaseToken = `dls_${leaseId}.${leaseSecret}`;
    const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
    this.db.prepare("UPDATE job_runs SET status='RUNNING', started_at=?, lease_id=?, lease_token_hash=?, lease_expires_at=?, commit_sha_before=?, updated_at=? WHERE id=? AND status='QUEUED'").run(
      timestamp,
      leaseId,
      workerTokenDigest(leaseSecret),
      leaseExpiresAt,
      "9f4c2b78",
      timestamp,
      job.id
    );
    const worker = this.getWorker(job.workerId);
    if (worker) {
      const updated = { ...worker, status: "BUSY" as const, activeJobs: worker.activeJobs + 1, lastHeartbeatAt: timestamp, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status='BUSY', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), timestamp, worker.id);
    }
    this.appendJobEvent(job.id, "STATUS", "INFO", "Worker claimed the accepted job", { leaseExpiresAt, executor: "DEMO" });
    return { task: this.transitionUnsafe(task, "RUNNING", { kind: "WORKER", id: job.workerId }, "Worker claimed the job with an active lease", "WORKER_CLAIMED"), leaseToken };
  }

  private insertArtifact(task: TaskRecord, job: JobRunRecord, artifactType: string, fileName: string, mimeType: string, content: string): EvidenceArtifactRecord {
    const digest = getEvidenceDigest(content);
    const timestamp = now();
    const artifact: EvidenceArtifactRecord = {
      id: randomUUID(),
      taskId: task.id,
      workerId: job.workerId,
      jobRunId: job.id,
      artifactType,
      fileName,
      mimeType,
      size: digest.size,
      sha256: digest.sha256,
      storagePath: `task/${task.id}/job/${job.id}/${randomUUID()}-${fileName}`,
      content,
      createdAt: timestamp
    };
    this.db.prepare("INSERT INTO evidence_artifacts(id,task_id,worker_id,job_run_id,artifact_type,file_name,mime_type,size,sha256,storage_path,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      artifact.id,
      artifact.taskId,
      artifact.workerId,
      artifact.jobRunId,
      artifact.artifactType,
      artifact.fileName,
      artifact.mimeType,
      artifact.size,
      artifact.sha256,
      artifact.storagePath,
      artifact.content,
      timestamp,
      timestamp
    );
    return artifact;
  }

  private generateDemoEvidence(task: TaskRecord, job: JobRunRecord): void {
    const existing = this.row("SELECT id FROM evidence_artifacts WHERE job_run_id = ? LIMIT 1", job.id);
    if (existing) return;
    const command = { commandId: "NPM_TEST", exitCode: 0, stdout: "12 tests passed", stderr: "" };
    const tests = { total: 12, passed: 12, failed: 0, skipped: 0 };
    const build = { commandId: "NPM_BUILD", success: true, exitCode: 0 };
    const diff = {
      patch: "diff --git a/src/auth/session.ts b/src/auth/session.ts\n- return elapsed > ttl\n+ return elapsed >= ttl",
      changedFiles: ["src/auth/session.ts", "src/auth/session.test.ts", "CHANGELOG.md"]
    };
    const manifest = { paths: ["src/auth/session.ts", "src/auth/session.test.ts", "package.json"] };
    this.insertArtifact(task, job, "COMMAND_RESULT", "npm-test.json", "application/json", JSON.stringify(command));
    this.insertArtifact(task, job, "TEST_RESULT", "test-results.json", "application/json", JSON.stringify(tests));
    this.insertArtifact(task, job, "BUILD_RESULT", "build-result.json", "application/json", JSON.stringify(build));
    this.insertArtifact(task, job, "GIT_DIFF", "changes.diff", "text/x-diff", JSON.stringify(diff));
    this.insertArtifact(task, job, "FILE_MANIFEST", "file-manifest.json", "application/json", JSON.stringify(manifest));
    this.insertArtifact(task, job, "SCREENSHOT", "test-report.png", "image/png", "SIMULATED_PNG_EVIDENCE_FOR_DEMO_MODE");
    this.appendJobEvent(job.id, "EVIDENCE", "SUCCESS", "Evidence pack uploaded and artifact hashes calculated", { artifacts: 6 });
  }

  private runJobStep(task: TaskRecord): TaskRecord {
    const job = this.getLatestJob(task.id);
    if (!job) throw new Error("Running task has no job run.");
    const countRow = this.row("SELECT COUNT(*) AS count FROM job_run_events WHERE job_run_id = ?", job.id);
    const count = countRow ? number(countRow.count) : 0;
    if (count <= 1) {
      this.appendJobEvent(job.id, "LOG", "INFO", "Created an isolated one-time demo workspace");
      this.appendJobEvent(job.id, "PROGRESS", "INFO", "Repository inspected; reproducing authentication failures", { percent: 28 });
      return task;
    }
    if (count <= 3) {
      this.appendJobEvent(job.id, "FILE_CHANGE", "INFO", "Adjusted session timeout boundary and strengthened its regression test", { files: ["src/auth/session.ts", "src/auth/session.test.ts"] });
      this.appendJobEvent(job.id, "TEST", "SUCCESS", "Authentication suite completed: 12 passed, 0 failed", { total: 12, passed: 12, failed: 0 });
      this.appendJobEvent(job.id, "BUILD", "SUCCESS", "Production build completed with exit code 0", { exitCode: 0 });
      this.generateDemoEvidence(task, job);
      return task;
    }

    const timestamp = now();
    this.db.prepare("UPDATE job_runs SET status='SUBMITTED', ended_at=?, exit_code=0, commit_sha_after=?, updated_at=? WHERE id=?").run(timestamp, "c73a1e52", timestamp, job.id);
    this.reconcileWorkerCapacity(job.workerId);
    this.appendJobEvent(job.id, "STATUS", "SUCCESS", "Demo executor submitted a structured result", { exitCode: 0, changedFiles: 3 });
    return this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: job.workerId }, "Worker submitted logs, patch and evidence", "EVIDENCE_SUBMITTED");
  }

  private artifactsToEvidence(task: TaskRecord, job: JobRunRecord): EvidenceInput[] {
    const artifacts = this.rows("SELECT * FROM evidence_artifacts WHERE job_run_id = ? ORDER BY created_at", job.id).map(mapArtifact);
    return artifacts.map((artifact): EvidenceInput => {
      const base = { id: artifact.id, createdAt: artifact.createdAt, jobRunId: job.id, workerId: job.workerId };
      const structured = artifact.mimeType === "application/json" || artifact.artifactType === "GIT_DIFF" ? (JSON.parse(artifact.content) as Record<string, unknown>) : {};
      switch (artifact.artifactType) {
        case "COMMAND_RESULT":
          return { ...base, type: "COMMAND", commandId: String(structured.commandId), exitCode: Number(structured.exitCode), stdout: String(structured.stdout ?? ""), stderr: String(structured.stderr ?? "") };
        case "TEST_RESULT":
          return { ...base, type: "TEST", total: Number(structured.total), passed: Number(structured.passed), failed: Number(structured.failed), skipped: Number(structured.skipped) };
        case "BUILD_RESULT":
          return { ...base, type: "BUILD", commandId: String(structured.commandId), success: Boolean(structured.success), exitCode: Number(structured.exitCode) };
        case "GITHUB_CHECK_RESULT":
          return {
            ...base,
            type: "GITHUB_CHECK",
            checkName: String(structured.checkName),
            repository: structured.repository ? String(structured.repository) : undefined,
            status: String(structured.status) as "SUCCESS" | "FAILURE" | "PENDING",
            commitSha: structured.commitSha ? String(structured.commitSha) : undefined
          };
        case "GIT_DIFF":
          return { ...base, type: "DIFF", patch: String(structured.patch), changedFiles: structured.changedFiles as string[] };
        case "FILE_MANIFEST":
          return { ...base, type: "FILE_MANIFEST", paths: structured.paths as string[] };
        case "PULL_REQUEST":
          return { ...base, type: "PULL_REQUEST", url: String(structured.url), number: Number(structured.number), state: String(structured.state) as "OPEN" | "CLOSED" | "MERGED", targetBranch: String(structured.targetBranch) };
        case "HUMAN_APPROVAL":
          return { ...base, type: "HUMAN_APPROVAL", actorKind: "CUSTOMER", actorId: task.customerId, approved: true, approvedAt: artifact.createdAt };
        default:
          return {
            ...base,
            type: "ARTIFACT",
            artifactType: artifact.artifactType === "SCREENSHOT" ? "SCREENSHOT" : "OTHER",
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            size: artifact.size,
            sha256: artifact.sha256,
            storagePath: artifact.storagePath
          };
      }
    });
  }

  private verifyTask(task: TaskRecord): TaskRecord {
    const job = this.getLatestJob(task.id);
    if (!job) throw new Error("Submitted task has no job run.");
    const approvalExists = this.row("SELECT id FROM evidence_artifacts WHERE job_run_id=? AND artifact_type='HUMAN_APPROVAL'", job.id);
    if (!approvalExists) {
      this.insertArtifact(task, job, "HUMAN_APPROVAL", "customer-approval.json", "application/json", JSON.stringify({ actorKind: "CUSTOMER", actorId: task.customerId, approved: true }));
    }
    const proof = evaluateProofOfDone(task.acceptanceChecks, this.artifactsToEvidence(task, job));
    const timestamp = now();
    this.db.prepare("DELETE FROM verification_results WHERE task_id = ? AND job_run_id = ?").run(task.id, job.id);
    const insert = this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    for (const result of proof.results) {
      insert.run(
        randomUUID(),
        task.id,
        job.id,
        result.checkId,
        result.checkType,
        result.passed ? "PASSED" : "FAILED",
        result.message,
        JSON.stringify({ evidenceIds: result.evidenceIds, required: result.required }),
        timestamp,
        timestamp
      );
    }
    if (proof.passed) {
      this.db.prepare("UPDATE job_runs SET status='SUCCEEDED', updated_at=? WHERE id=?").run(timestamp, job.id);
      return this.transitionUnsafe(task, "VERIFICATION_PASSED", { kind: "SYSTEM", id: "proof-of-done" }, "Every required acceptance check passed independently", "VERIFICATION_PASSED");
    }
    return this.transitionUnsafe(task, "VERIFICATION_FAILED", { kind: "SYSTEM", id: "proof-of-done" }, "One or more required acceptance checks failed", "VERIFICATION_FAILED");
  }

  advanceDemo(taskId: string): TaskAggregate {
    return this.transaction(() => {
      let task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      switch (task.status) {
        case "DRAFT":
          task = this.transitionUnsafe(task, "PUBLISHED", { kind: "CUSTOMER", id: task.customerId }, "Customer published the reviewed task scope", "TASK_PUBLISHED");
          break;
        case "PUBLISHED":
          task = this.transitionUnsafe(task, "ANALYZING", { kind: "SYSTEM", id: "task-analyzer" }, "Rule-based analyzer started", "ANALYSIS_STARTED");
          break;
        case "ANALYZING":
          this.setAnalysis(task);
          task = this.getTask(task.id) ?? task;
          task = this.transitionUnsafe(task, "MATCHING", { kind: "SYSTEM", id: "task-analyzer" }, "Scope, capabilities, risk and verification checks were analyzed", "ANALYSIS_COMPLETED");
          break;
        case "MATCHING": {
          const matches = this.matchTask(task);
          task = this.getTask(task.id) ?? task;
          task = this.transitionUnsafe(task, "MATCHED", { kind: "SYSTEM", id: "matching-engine" }, `Ranked ${matches.length} eligible agent candidates`, "AGENT_MATCHED");
          break;
        }
        case "MATCHED":
          task = this.transitionUnsafe(task, "AWAITING_PROVIDER", { kind: "SYSTEM", id: "dispatch" }, "Top-ranked agent received a privacy-scoped offer", "OFFER_SENT");
          break;
        case "AWAITING_PROVIDER":
          task = this.acceptAssignment(task);
          break;
        case "ASSIGNED":
          task = this.claimJob(task).task;
          break;
        case "RUNNING":
          task = this.runJobStep(task);
          break;
        case "SUBMITTED":
          task = this.transitionUnsafe(task, "VERIFYING", { kind: "SYSTEM", id: "proof-of-done" }, "Independent verifier started against immutable evidence", "VERIFICATION_STARTED");
          break;
        case "VERIFYING":
          task = this.verifyTask(task);
          break;
        case "VERIFICATION_PASSED":
          task = this.transitionUnsafe(task, "CUSTOMER_REVIEW", { kind: "SYSTEM", id: "proof-of-done" }, "Verified evidence pack is ready for customer review", "CUSTOMER_REVIEW_REQUESTED");
          break;
        case "CUSTOMER_REVIEW":
          task = this.completeAndRelease(task);
          break;
        default:
          break;
      }
      return this.getTaskAggregate(task.id);
    });
  }

  private reserve(taskId: string, customerId: string, amountCents: number): void {
    const key = `reserve:${taskId}`;
    if (this.row("SELECT id FROM test_ledger_entries WHERE transaction_key = ? LIMIT 1", key)) return;
    const customer = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='CUSTOMER'", customerId);
    const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
    if (!customer || !escrow || number(customer.available_cents) < amountCents) throw new Error("Insufficient test balance.");
    const timestamp = now();
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, reserved_cents=reserved_cents+?, updated_at=? WHERE id=?").run(amountCents, amountCents, timestamp, string(customer.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(amountCents, timestamp, string(escrow.id));
    this.insertLedger(taskId, string(customer.id), key, "RESERVE", -amountCents);
    this.insertLedger(taskId, string(escrow.id), key, "RESERVE", amountCents);
  }

  private insertLedger(taskId: string, walletId: string, transactionKey: string, entryType: LedgerEntryRecord["entryType"], amountCents: number): void {
    const timestamp = now();
    this.db.prepare("INSERT INTO test_ledger_entries(id,task_id,wallet_id,transaction_key,entry_type,amount_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      taskId,
      walletId,
      transactionKey,
      entryType,
      amountCents,
      timestamp,
      timestamp
    );
  }

  private release(task: TaskRecord): void {
    const key = `release:${task.id}`;
    if (this.row("SELECT id FROM test_ledger_entries WHERE transaction_key=? LIMIT 1", key)) return;
    const providerAmount = Math.round(task.budgetCents * 0.8);
    const fee = task.budgetCents - providerAmount;
    const customer = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='CUSTOMER'", task.customerId);
    const provider = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='PROVIDER'", PROVIDER_ALPHA_ID);
    const platform = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='PLATFORM'", PLATFORM_ID);
    const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
    if (!customer || !provider || !platform || !escrow || number(escrow.available_cents) < task.budgetCents) throw new Error("Ledger invariant failed during release.");
    const timestamp = now();
    this.db.prepare("UPDATE test_wallets SET reserved_cents=reserved_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(customer.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(escrow.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(providerAmount, timestamp, string(provider.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(fee, timestamp, string(platform.id));
    this.insertLedger(task.id, string(escrow.id), key, "RELEASE", -task.budgetCents);
    this.insertLedger(task.id, string(provider.id), key, "RELEASE", providerAmount);
    this.insertLedger(task.id, string(platform.id), key, "PLATFORM_FEE", fee);
  }

  private completeAndRelease(task: TaskRecord): TaskRecord {
    const failed = this.row("SELECT id FROM verification_results WHERE task_id=? AND status!='PASSED' LIMIT 1", task.id);
    const requiredCount = task.acceptanceChecks.filter((check) => check.required).length;
    const passedRow = this.row("SELECT COUNT(*) AS count FROM verification_results WHERE task_id=? AND status='PASSED'", task.id);
    if (failed || !passedRow || number(passedRow.count) < requiredCount) throw new Error("Task cannot complete before every required check passes.");
    this.release(task);
    const assignment = this.getLatestAssignment(task.id);
    if (assignment) this.db.prepare("UPDATE task_assignments SET status='COMPLETED', updated_at=? WHERE id=?").run(now(), assignment.id);
    return this.transitionUnsafe(task, "COMPLETED", { kind: "CUSTOMER", id: task.customerId }, "Customer accepted the verified delivery and released the test ledger", "CUSTOMER_ACCEPTED");
  }

  refundTask(taskId: string, actor: Actor): void {
    this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      if (actor.kind !== "CUSTOMER" && actor.kind !== "ADMIN") throw new Error("Only the customer or admin may refund a task.");
      const key = `refund:${task.id}`;
      if (this.row("SELECT id FROM test_ledger_entries WHERE transaction_key=? LIMIT 1", key)) return;
      const customer = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='CUSTOMER'", task.customerId);
      const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
      if (!customer || !escrow || number(escrow.available_cents) < task.budgetCents) throw new Error("No reserved amount is available to refund.");
      const timestamp = now();
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, reserved_cents=reserved_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, task.budgetCents, timestamp, string(customer.id));
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(escrow.id));
      this.insertLedger(task.id, string(escrow.id), key, "REFUND", -task.budgetCents);
      this.insertLedger(task.id, string(customer.id), key, "REFUND", task.budgetCents);
    });
  }

  openDispute(taskId: string, actor: Actor, reason: string): DisputeRecord {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      if (actor.kind !== "ADMIN" && (actor.kind !== "CUSTOMER" || actor.id !== task.customerId)) throw new Error("Only the task customer or Admin may open a dispute.");
      if (task.status !== "CUSTOMER_REVIEW" && task.status !== "VERIFICATION_FAILED") throw new Error("A dispute can be opened only during customer review or after failed verification.");
      const existing = this.row("SELECT * FROM disputes WHERE task_id=? AND status IN ('OPEN','UNDER_REVIEW')", taskId);
      if (existing) return mapDispute(existing);
      const cleanReason = reason.trim();
      if (cleanReason.length < 10 || cleanReason.length > 5000) throw new Error("Provide a dispute reason between 10 and 5000 characters.");
      const key = `hold:${task.id}`;
      const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
      const hold = this.row("SELECT * FROM test_wallets WHERE kind='DISPUTE' LIMIT 1");
      if (!escrow || !hold || number(escrow.available_cents) < task.budgetCents) throw new Error("Reserved funds are not available for dispute hold.");
      const timestamp = now();
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(escrow.id));
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(hold.id));
      this.insertLedger(task.id, string(escrow.id), key, "DISPUTE_HOLD", -task.budgetCents);
      this.insertLedger(task.id, string(hold.id), key, "DISPUTE_HOLD", task.budgetCents);
      const dispute: DisputeRecord = { id: randomUUID(), taskId, openedBy: actor.id, reason: cleanReason, status: "OPEN", heldAmountCents: task.budgetCents, resolution: null, createdAt: timestamp, updatedAt: timestamp };
      this.db.prepare("INSERT INTO disputes(id,task_id,opened_by,reason,status,held_amount_cents,resolution,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,?)").run(dispute.id, taskId, actor.id, cleanReason, dispute.status, dispute.heldAmountCents, timestamp, timestamp);
      this.transitionUnsafe(task, "DISPUTED", actor, "Customer opened a dispute and funds moved to dispute hold", "DISPUTE_OPENED");
      return dispute;
    });
  }

  listDisputes(): DisputeRecord[] {
    return this.rows("SELECT * FROM disputes ORDER BY created_at DESC").map(mapDispute);
  }

  listAuditLogs(limit = 100): AuditLogRecord[] {
    return this.rows("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", Math.max(1, Math.min(500, limit))).map(mapAudit);
  }

  recordWebhookReceipt(source: string, deliveryId: string, eventType: string, bodySha256: string): boolean {
    return this.transaction(() => {
      if (this.row("SELECT id FROM webhook_receipts WHERE source=? AND delivery_id=?", source, deliveryId)) return false;
      const timestamp = now();
      this.db.prepare("INSERT INTO webhook_receipts(id,source,delivery_id,event_type,body_sha256,verified,processed,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)").run(randomUUID(), source, deliveryId, eventType, bodySha256, timestamp, timestamp);
      this.insertAudit({ kind: "SYSTEM", id: source }, "WEBHOOK_ACCEPTED", "webhook_delivery", deliveryId, { eventType, bodySha256 });
      return true;
    });
  }

  recordAgentCallback(agentId: string, jobRunId: string, callbackType: "status" | "result" | "error", payload: Record<string, unknown>): void {
    this.transaction(() => {
      const job = this.getJobRun(jobRunId);
      if (!job || job.agentId !== agentId) throw new Error("Callback does not belong to this Agent job.");
      const level: JobEventRecord["level"] = callbackType === "error" ? "ERROR" : callbackType === "result" ? "SUCCESS" : "INFO";
      const message = typeof payload.message === "string" ? payload.message : typeof payload.summary === "string" ? payload.summary : `Webhook Agent ${callbackType} callback received`;
      this.appendJobEvent(jobRunId, callbackType === "status" ? "PROGRESS" : "STATUS", level, message, { source: "WEBHOOK_AGENT", ...payload });
      this.insertAudit({ kind: "SYSTEM", id: `webhook-agent:${agentId}` }, "AGENT_CALLBACK_RECORDED", "job_run", jobRunId, { callbackType });
    });
  }

  listProfiles(): ProfileRecord[] {
    return this.rows("SELECT * FROM profiles ORDER BY created_at").map((row) => ({
      id: string(row.id),
      name: string(row.name),
      role: string(row.role) as ProfileRecord["role"],
      createdAt: string(row.created_at),
      updatedAt: string(row.updated_at)
    }));
  }

  adminSuspendWorker(workerId: string, adminId: string): WorkerRecord {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const timestamp = now();
      const updated: WorkerRecord = { ...worker, status: "SUSPENDED", acceptingJobs: false, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status='SUSPENDED', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), timestamp, workerId);
      this.insertAudit({ kind: "ADMIN", id: adminId }, "WORKER_SUSPENDED", "worker", workerId);
      return updated;
    });
  }

  adminSuspendAgent(agentId: string, adminId: string): AgentRecord {
    return this.transaction(() => {
      const agent = this.getAgentById(agentId);
      if (!agent) throw new Error("Agent not found.");
      const timestamp = now();
      const updated: AgentRecord = { ...agent, verificationStatus: "SUSPENDED", acceptingTasks: false, updatedAt: timestamp };
      this.db.prepare("UPDATE agents SET data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), timestamp, agentId);
      this.insertAudit({ kind: "ADMIN", id: adminId }, "AGENT_SUSPENDED", "agent", agentId);
      return updated;
    });
  }

  adminRematchTask(taskId: string, adminId: string): TaskRecord {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      if (task.status !== "MATCHED" && task.status !== "AWAITING_PROVIDER" && task.status !== "ASSIGNED") throw new Error("Task cannot be rematched from its current state.");
      this.db.prepare("DELETE FROM task_matches WHERE task_id=?").run(taskId);
      this.db.prepare("UPDATE tasks SET matched_agent_id=NULL, assigned_worker_id=NULL, updated_at=? WHERE id=?").run(now(), taskId);
      return this.transitionUnsafe(task, "MATCHING", { kind: "ADMIN", id: adminId }, "Admin requested manual rematching", "ADMIN_REMATCHED");
    });
  }

  getTaskAggregate(taskId: string): TaskAggregate {
    const task = this.getTask(taskId);
    if (!task) throw new Error("Task not found.");
    const matchRows = this.rows("SELECT * FROM task_matches WHERE task_id=? ORDER BY rank", taskId).map(mapMatch);
    const matches = matchRows.flatMap((match) => {
      const agent = this.getAgentById(match.agentId);
      return agent ? [{ ...match, agent }] : [];
    });
    const assignment = this.getLatestAssignment(taskId);
    const jobRun = this.getLatestJob(taskId);
    return {
      task,
      events: this.rows("SELECT * FROM task_events WHERE task_id=? ORDER BY sequence", taskId).map(mapTaskEvent),
      matches,
      agent: task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null,
      worker: task.assignedWorkerId ? this.getWorker(task.assignedWorkerId) : null,
      assignment,
      jobRun,
      jobEvents: jobRun ? this.rows("SELECT * FROM job_run_events WHERE job_run_id=? ORDER BY sequence", jobRun.id).map(mapJobEvent) : [],
      evidence: jobRun ? this.rows("SELECT * FROM evidence_artifacts WHERE job_run_id=? ORDER BY created_at", jobRun.id).map(mapArtifact) : [],
      verificationResults: jobRun ? this.rows("SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at", jobRun.id).map(mapVerification) : [],
      ledgerEntries: this.rows("SELECT * FROM test_ledger_entries WHERE task_id=? ORDER BY created_at", taskId).map(mapLedger)
    };
  }

  getWallet(ownerId: string, kind: WalletRecord["kind"]): WalletRecord {
    const found = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind=?", ownerId, kind);
    if (!found) throw new Error("Wallet not found.");
    return mapWallet(found);
  }

  listAssignments(providerId?: string): AssignmentRecord[] {
    const found = providerId
      ? this.rows("SELECT * FROM task_assignments WHERE provider_id=? ORDER BY created_at DESC", providerId)
      : this.rows("SELECT * FROM task_assignments ORDER BY created_at DESC");
    return found.map(mapAssignment);
  }

  getJobRun(jobId: string): JobRunRecord | null {
    const found = this.row("SELECT * FROM job_runs WHERE id=?", jobId);
    return found ? mapJobRun(found) : null;
  }

  listJobRuns(providerId?: string): JobRunRecord[] {
    const found = providerId
      ? this.rows("SELECT j.* FROM job_runs j JOIN task_assignments a ON a.id=j.assignment_id WHERE a.provider_id=? ORDER BY j.created_at DESC", providerId)
      : this.rows("SELECT * FROM job_runs ORDER BY created_at DESC");
    return found.map(mapJobRun);
  }

  listProviderTasks(providerId: string): TaskRecord[] {
    return this.listTasks().filter((task) => {
      if (!task.matchedAgentId) return false;
      return this.getAgentById(task.matchedAgentId)?.providerId === providerId;
    });
  }

  acceptTaskAsProvider(taskId: string, providerId: string): TaskAggregate {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task || task.status !== "AWAITING_PROVIDER") throw new Error("Task is not awaiting provider acceptance.");
      const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
      if (!agent || agent.providerId !== providerId) throw new Error("This task is not offered to your provider account.");
      this.acceptAssignment(task);
      return this.getTaskAggregate(taskId);
    });
  }

  providerTaskDecision(taskId: string, providerId: string, decision: "ACCEPT" | "DECLINE" | "LATER"): TaskAggregate {
    if (decision === "ACCEPT") return this.acceptTaskAsProvider(taskId, providerId);
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task || task.status !== "AWAITING_PROVIDER") throw new Error("Task is not awaiting a provider decision.");
      const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
      const match = this.row("SELECT * FROM task_matches WHERE task_id=? AND rank=1", taskId);
      if (!agent || !match || agent.providerId !== providerId) throw new Error("This offer is not assigned to your provider account.");
      if (decision === "LATER") {
        this.insertTaskEvent(task.id, task.status, task.status, { kind: "PROVIDER", id: providerId }, "Provider scheduled the offer for later review", "PROVIDER_DEFERRED");
        return this.getTaskAggregate(taskId);
      }
      const timestamp = now();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'DECLINED',?,?,?,NULL,?,?)").run(
        randomUUID(),
        task.id,
        agent.id,
        providerId,
        string(match.worker_id),
        task.budgetCents,
        Math.round(task.budgetCents * 0.8),
        task.budgetCents - Math.round(task.budgetCents * 0.8),
        timestamp,
        timestamp
      );
      this.transitionUnsafe(task, "MATCHING", { kind: "PROVIDER", id: providerId }, "Provider declined the task offer", "PROVIDER_DECLINED");
      return this.getTaskAggregate(taskId);
    });
  }

  createWorker(providerId: string, name: string, os: WorkerRecord["os"]): WorkerRecord {
    return this.transaction(() => {
      const timestamp = now();
      const worker: WorkerRecord = {
        id: randomUUID(),
        providerId,
        name: name.trim().slice(0, 100) || "New Worker",
        status: "OFFLINE",
        os,
        installedTools: [],
        mcpTools: [],
        executors: ["DEMO"],
        maxConcurrentJobs: 1,
        activeJobs: 0,
        lastHeartbeatAt: timestamp,
        tokenHash: null,
        tokenId: null,
        acceptingJobs: true,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.db.prepare("INSERT INTO worker_nodes(id,provider_id,status,token_hash,token_id,data_json,created_at,updated_at) VALUES(?,?,?,NULL,NULL,?,?,?)").run(
        worker.id,
        providerId,
        worker.status,
        JSON.stringify(worker),
        timestamp,
        timestamp
      );
      this.insertAudit({ kind: "PROVIDER", id: providerId }, "WORKER_CREATED", "worker", worker.id, { os });
      return worker;
    });
  }

  createAgent(input: {
    providerId: string;
    providerName: string;
    name: string;
    slug: string;
    description: string;
    skills: string[];
    taskTypes: AgentRecord["taskTypes"];
    languages: string[];
    operatingSystems: string[];
    tools: string[];
    requiredMcpServers: string[];
    pricingModel: AgentRecord["pricingModel"];
    basePriceCents: number;
    endpointType: AgentRecord["endpointType"];
    endpointUrl: string | null;
    authenticationType: AgentRecord["authenticationType"];
    inputModes: string[];
    outputModes: string[];
  }): AgentRecord {
    return this.transaction(() => {
      if (this.getAgentBySlug(input.slug)) throw new Error("Agent slug is already in use.");
      const timestamp = now();
      const agent: AgentRecord = {
        id: randomUUID(),
        slug: input.slug,
        name: input.name,
        version: "1.0.0",
        providerId: input.providerId,
        providerName: input.providerName,
        description: input.description,
        skills: input.skills,
        taskTypes: input.taskTypes,
        languages: input.languages,
        operatingSystems: input.operatingSystems,
        tools: input.tools,
        requiredMcpServers: input.requiredMcpServers,
        pricingModel: input.pricingModel,
        basePriceCents: input.basePriceCents,
        averageCompletionMinutes: 120,
        completedTasks: 0,
        verifiedSuccessRate: 0,
        rating: 0,
        workerStatus: "OFFLINE",
        lastActiveAt: timestamp,
        verificationStatus: "PENDING",
        endpointType: input.endpointType,
        endpointUrl: input.endpointUrl,
        authenticationType: input.authenticationType,
        inputModes: input.inputModes,
        outputModes: input.outputModes,
        acceptingTasks: false,
        recentFailures: 0,
        currentWorkload: 0,
        maxConcurrentJobs: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.db.prepare("INSERT INTO agents(id,slug,provider_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(agent.id, agent.slug, agent.providerId, JSON.stringify(agent), timestamp, timestamp);
      this.insertAudit({ kind: "PROVIDER", id: input.providerId }, "AGENT_CREATED", "agent", agent.id, { endpointType: input.endpointType });
      return agent;
    });
  }

  getDashboardSnapshot(): DashboardSnapshot {
    const tasks = this.listTasks();
    const taskCounts: Record<string, number> = {};
    for (const task of tasks) taskCounts[task.status] = (taskCounts[task.status] ?? 0) + 1;
    return {
      taskCounts,
      tasks,
      customerWallet: this.getWallet(CUSTOMER_ID, "CUSTOMER"),
      providerWallet: this.getWallet(PROVIDER_ALPHA_ID, "PROVIDER"),
      platformWallet: this.getWallet(PLATFORM_ID, "PLATFORM"),
      agents: this.listAgents(),
      workers: this.listWorkers()
    };
  }

  createPairingCode(workerId: string, providerId: string): { code: string; expiresAt: string } {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker || worker.providerId !== providerId) throw new Error("Worker not found for this provider.");
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      const bytes = randomBytes(12);
      const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
      const code = `DL-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const timestamp = now();
      this.db.prepare("INSERT INTO worker_pairing_codes(id,worker_id,code_hash,expires_at,consumed_at,attempts,created_at,updated_at) VALUES(?,?,?,?,NULL,0,?,?)").run(
        randomUUID(),
        workerId,
        pairingDigest(code),
        expiresAt,
        timestamp,
        timestamp
      );
      this.insertAudit({ kind: "PROVIDER", id: providerId }, "PAIRING_CODE_CREATED", "worker", workerId, { expiresAt });
      return { code, expiresAt };
    });
  }

  pairWorker(code: string): { workerId: string; token: string } {
    return this.transaction(() => {
      const digest = pairingDigest(code);
      const pairing = this.row("SELECT * FROM worker_pairing_codes WHERE code_hash=?", digest);
      if (!pairing || nullableString(pairing.consumed_at) || Date.parse(string(pairing.expires_at)) <= Date.now() || number(pairing.attempts) >= 5) {
        if (pairing) this.db.prepare("UPDATE worker_pairing_codes SET attempts=attempts+1, updated_at=? WHERE id=?").run(now(), string(pairing.id));
        throw new Error("Pairing code is invalid or expired.");
      }
      const workerId = string(pairing.worker_id);
      const tokenId = randomBytes(8).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const token = `dwk_${tokenId}.${secret}`;
      const timestamp = now();
      this.db.prepare("UPDATE worker_pairing_codes SET consumed_at=?, updated_at=? WHERE id=?").run(timestamp, timestamp, string(pairing.id));
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker no longer exists.");
      const updated: WorkerRecord = { ...worker, tokenHash: workerTokenDigest(secret), tokenId, status: "ONLINE", lastHeartbeatAt: timestamp, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET token_hash=?, token_id=?, status='ONLINE', data_json=?, updated_at=? WHERE id=?").run(updated.tokenHash, tokenId, JSON.stringify(updated), timestamp, workerId);
      this.insertAudit({ kind: "WORKER", id: workerId }, "WORKER_PAIRED", "worker", workerId);
      return { workerId, token };
    });
  }

  authenticateWorker(token: string): WorkerRecord | null {
    const match = /^dwk_([a-f0-9]{16})\.([A-Za-z0-9_-]{40,})$/.exec(token);
    if (!match?.[1] || !match[2]) return null;
    const found = this.row("SELECT * FROM worker_nodes WHERE token_id=?", match[1]);
    if (!found) return null;
    const worker = mapWorker(found);
    const actual = workerTokenDigest(match[2]);
    return worker.tokenHash && safeEqualHex(worker.tokenHash, actual) ? worker : null;
  }

  private validateJobLease(jobRunId: string, workerId: string, leaseToken: string): JobRunRecord {
    const match = /^dls_([a-f0-9]{16})\.([A-Za-z0-9_-]{40,})$/.exec(leaseToken);
    const job = this.getJobRun(jobRunId);
    if (!match?.[1] || !match[2] || !job || job.workerId !== workerId || job.leaseId !== match[1] || !job.leaseTokenHash) throw new Error("Job lease is invalid.");
    if (!safeEqualHex(job.leaseTokenHash, workerTokenDigest(match[2]))) throw new Error("Job lease is invalid.");
    if (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new Error("Job lease has expired.");
    if (job.status !== "RUNNING") throw new Error("Job run is not active.");
    return job;
  }

  renewJobLease(jobRunId: string, workerId: string, leaseToken: string): string {
    return this.transaction(() => {
      this.validateJobLease(jobRunId, workerId, leaseToken);
      const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
      this.db.prepare("UPDATE job_runs SET lease_expires_at=?, updated_at=? WHERE id=?").run(leaseExpiresAt, now(), jobRunId);
      return leaseExpiresAt;
    });
  }

  getJobControl(jobRunId: string, workerId: string, leaseToken: string): { cancelRequested: boolean; leaseExpiresAt: string } {
    const job = this.validateJobLease(jobRunId, workerId, leaseToken);
    return { cancelRequested: false, leaseExpiresAt: job.leaseExpiresAt ?? new Date().toISOString() };
  }

  appendWorkerProtocolEvent(
    jobRunId: string,
    workerId: string,
    leaseToken: string,
    event: { eventId: string; type: string; message: string; progress?: number; data?: Record<string, unknown>; createdAt: string }
  ): void {
    this.transaction(() => {
      this.validateJobLease(jobRunId, workerId, leaseToken);
      if (this.row("SELECT id FROM job_run_events WHERE id=?", event.eventId)) return;
      const sequenceRow = this.row("SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM job_run_events WHERE job_run_id=?", jobRunId);
      const sequence = sequenceRow ? number(sequenceRow.next_sequence) : 1;
      const kind: JobEventRecord["kind"] = event.type === "TEST_RESULT" ? "TEST" : event.type === "BUILD_RESULT" ? "BUILD" : event.type === "FILE_CHANGED" ? "FILE_CHANGE" : event.type === "PROGRESS" ? "PROGRESS" : event.type === "ARTIFACT_CREATED" ? "EVIDENCE" : event.type === "LOG" ? "LOG" : "STATUS";
      const level: JobEventRecord["level"] = event.type.includes("FAILED") ? "ERROR" : event.type === "EXECUTOR_FINISHED" || event.type === "TEST_RESULT" || event.type === "BUILD_RESULT" ? "SUCCESS" : "INFO";
      this.db.prepare("INSERT INTO job_run_events(id,job_run_id,sequence,kind,level,message,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        event.eventId,
        jobRunId,
        sequence,
        kind,
        level,
        event.message.slice(0, 16_384),
        JSON.stringify({ progress: event.progress, data: event.data ?? {} }),
        event.createdAt,
        now()
      );
    });
  }

  initializeArtifactUpload(
    jobRunId: string,
    workerId: string,
    leaseToken: string,
    metadata: { artifactType: string; fileName: string; mimeType: string; size: number; sha256: string }
  ): { artifactId: string; uploadToken: string; expiresAt: string } {
    return this.transaction(() => {
      this.validateJobLease(jobRunId, workerId, leaseToken);
      const allowedTypes = new Set(["text/plain", "text/x-diff", "application/json", "image/png", "image/jpeg", "image/webp"]);
      if (!allowedTypes.has(metadata.mimeType)) throw new Error("Artifact MIME type is not allowed.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(metadata.fileName)) throw new Error("Artifact file name is invalid.");
      if (!Number.isInteger(metadata.size) || metadata.size < 0 || metadata.size > 10 * 1024 * 1024) throw new Error("Artifact size exceeds the 10 MB limit.");
      if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error("Artifact SHA-256 is invalid.");
      const artifactId = randomUUID();
      const uploadToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const timestamp = now();
      this.db.prepare("INSERT INTO artifact_uploads(id,job_run_id,worker_id,artifact_type,file_name,mime_type,expected_size,expected_sha256,upload_token_hash,content_base64,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,'PENDING',?,?,?)").run(
        artifactId,
        jobRunId,
        workerId,
        metadata.artifactType,
        metadata.fileName,
        metadata.mimeType,
        metadata.size,
        metadata.sha256,
        workerTokenDigest(uploadToken),
        expiresAt,
        timestamp,
        timestamp
      );
      return { artifactId, uploadToken, expiresAt };
    });
  }

  receiveArtifactUpload(artifactId: string, uploadToken: string, bytes: Uint8Array): void {
    this.transaction(() => {
      const upload = this.row("SELECT * FROM artifact_uploads WHERE id=?", artifactId);
      if (!upload || string(upload.status) !== "PENDING" || Date.parse(string(upload.expires_at)) <= Date.now()) throw new Error("Artifact upload is unavailable or expired.");
      if (!safeEqualHex(string(upload.upload_token_hash), workerTokenDigest(uploadToken))) throw new Error("Artifact upload token is invalid.");
      if (bytes.byteLength !== number(upload.expected_size)) throw new Error("Artifact size does not match the signed request.");
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (!safeEqualHex(digest, string(upload.expected_sha256))) throw new Error("Artifact hash does not match the signed request.");
      const mimeType = string(upload.mime_type);
      if (mimeType === "image/png" && !(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) throw new Error("PNG signature is invalid.");
      this.db.prepare("UPDATE artifact_uploads SET content_base64=?, status='UPLOADED', updated_at=? WHERE id=?").run(Buffer.from(bytes).toString("base64"), now(), artifactId);
    });
  }

  finalizeArtifactUpload(jobRunId: string, workerId: string, leaseToken: string, artifactId: string, suppliedSha256: string): EvidenceArtifactRecord {
    return this.transaction(() => {
      this.validateJobLease(jobRunId, workerId, leaseToken);
      const upload = this.row("SELECT * FROM artifact_uploads WHERE id=? AND job_run_id=? AND worker_id=?", artifactId, jobRunId, workerId);
      if (!upload || string(upload.status) !== "UPLOADED" || !upload.content_base64) throw new Error("Artifact upload is not ready to finalize.");
      if (!safeEqualHex(string(upload.expected_sha256), suppliedSha256)) throw new Error("Artifact finalize hash does not match.");
      const bytes = Buffer.from(string(upload.content_base64), "base64");
      const content = string(upload.mime_type).startsWith("image/") ? string(upload.content_base64) : bytes.toString("utf8");
      const timestamp = now();
      const taskRow = this.row("SELECT task_id FROM job_runs WHERE id=?", jobRunId);
      if (!taskRow) throw new Error("Task for artifact was not found.");
      const artifact: EvidenceArtifactRecord = {
        id: artifactId,
        taskId: string(taskRow.task_id),
        workerId,
        jobRunId,
        artifactType: string(upload.artifact_type),
        fileName: string(upload.file_name),
        mimeType: string(upload.mime_type),
        size: bytes.byteLength,
        sha256: string(upload.expected_sha256),
        storagePath: `task/${string(taskRow.task_id)}/job/${jobRunId}/${artifactId}-${string(upload.file_name)}`,
        content,
        createdAt: timestamp
      };
      this.db.prepare("INSERT INTO evidence_artifacts(id,task_id,worker_id,job_run_id,artifact_type,file_name,mime_type,size,sha256,storage_path,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        artifact.id,
        artifact.taskId,
        artifact.workerId,
        artifact.jobRunId,
        artifact.artifactType,
        artifact.fileName,
        artifact.mimeType,
        artifact.size,
        artifact.sha256,
        artifact.storagePath,
        artifact.content,
        timestamp,
        timestamp
      );
      this.db.prepare("UPDATE artifact_uploads SET status='FINALIZED', updated_at=? WHERE id=?").run(timestamp, artifactId);
      return artifact;
    });
  }

  submitWorkerJob(
    jobRunId: string,
    workerId: string,
    leaseToken: string,
    result: {
      status: "succeeded" | "failed" | "cancelled";
      summary: string;
      startedAt: string;
      endedAt: string;
      exitCode: number;
      commitShaBefore?: string;
      commitShaAfter?: string;
      gitDiff: string;
      changedFiles: string[];
      commandsRun: Array<{ commandId: string; exitCode: number; stdout?: string; stderr?: string }>;
      tests?: { total: number; passed: number; failed: number; skipped: number };
      buildSucceeded?: boolean;
      pullRequestUrl?: string;
    }
  ): TaskAggregate {
    return this.transaction(() => {
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      const task = this.getTask(job.taskId);
      if (!task || task.status !== "RUNNING") throw new Error("Task is not running.");
      if (result.status !== "succeeded" || result.exitCode !== 0) throw new Error("Failed or cancelled Worker results cannot be submitted as done.");
      for (const command of result.commandsRun) this.insertArtifact(task, job, "COMMAND_RESULT", `${command.commandId.toLowerCase()}.json`, "application/json", JSON.stringify(command));
      if (result.tests) this.insertArtifact(task, job, "TEST_RESULT", "structured-tests.json", "application/json", JSON.stringify(result.tests));
      this.insertArtifact(task, job, "BUILD_RESULT", "structured-build.json", "application/json", JSON.stringify({ commandId: "NPM_BUILD", success: result.buildSucceeded === true, exitCode: result.buildSucceeded ? 0 : 1 }));
      this.insertArtifact(task, job, "GIT_DIFF", "structured-changes.diff", "text/x-diff", JSON.stringify({ patch: result.gitDiff, changedFiles: result.changedFiles }));
      this.insertArtifact(task, job, "FILE_MANIFEST", "structured-files.json", "application/json", JSON.stringify({ paths: result.changedFiles }));
      if (result.pullRequestUrl) this.insertArtifact(task, job, "PULL_REQUEST", "pull-request.json", "application/json", JSON.stringify({ url: result.pullRequestUrl, number: 42, state: "OPEN", targetBranch: task.targetBranch }));
      const timestamp = now();
      this.db.prepare("UPDATE job_runs SET status='SUBMITTED', ended_at=?, exit_code=?, commit_sha_before=?, commit_sha_after=?, lease_expires_at=?, updated_at=? WHERE id=?").run(
        result.endedAt,
        result.exitCode,
        result.commitShaBefore ?? null,
        result.commitShaAfter ?? null,
        timestamp,
        timestamp,
        jobRunId
      );
      this.appendJobEvent(jobRunId, "STATUS", "SUCCESS", "Worker submitted a structured execution result", { summary: result.summary, exitCode: result.exitCode });
      this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: workerId }, "Worker submitted signed artifacts and a structured result", "EVIDENCE_SUBMITTED");
      this.reconcileWorkerCapacity(workerId);
      return this.getTaskAggregate(task.id);
    });
  }

  revokeWorkerToken(workerId: string): void {
    this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) return;
      const updated = { ...worker, tokenHash: null, tokenId: null, status: "OFFLINE" as const, updatedAt: now() };
      this.db.prepare("UPDATE worker_nodes SET token_hash=NULL, token_id=NULL, status='OFFLINE', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), now(), workerId);
    });
  }

  heartbeat(workerId: string, status: "ONLINE" | "BUSY", capabilities?: Partial<WorkerRecord>): WorkerRecord {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const timestamp = now();
      const updated: WorkerRecord = { ...worker, ...capabilities, id: worker.id, providerId: worker.providerId, tokenHash: worker.tokenHash, tokenId: worker.tokenId, status, lastHeartbeatAt: timestamp, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status=?, data_json=?, updated_at=? WHERE id=?").run(status, JSON.stringify(updated), timestamp, workerId);
      return updated;
    });
  }

  claimAssignedJob(workerId: string): { aggregate: TaskAggregate; leaseToken: string } | null {
    return this.transaction(() => {
      const found = this.row("SELECT t.id FROM tasks t JOIN job_runs j ON j.task_id=t.id WHERE j.worker_id=? AND j.status='QUEUED' AND t.status='ASSIGNED' ORDER BY j.created_at LIMIT 1", workerId);
      if (!found) return null;
      const task = this.getTask(string(found.id));
      if (!task) return null;
      const claimed = this.claimJob(task);
      return { aggregate: this.getTaskAggregate(task.id), leaseToken: claimed.leaseToken };
    });
  }
}

type GlobalStore = typeof globalThis & { __doneLayerDemoStore?: DemoStore };

export function getDemoStore(): DemoStore {
  const shared = globalThis as GlobalStore;
  shared.__doneLayerDemoStore ??= new DemoStore();
  return shared.__doneLayerDemoStore;
}

export const demoIds = {
  customer: CUSTOMER_ID,
  providerAlpha: PROVIDER_ALPHA_ID,
  platform: PLATFORM_ID,
  escrow: ESCROW_ID
} as const;
