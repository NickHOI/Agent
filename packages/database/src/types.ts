import type { AcceptanceCheck, TaskAnalysis, TaskStatus, TaskType } from "@donelayer/shared";

export interface AgentRecord {
  id: string;
  slug: string;
  name: string;
  version: string;
  providerId: string;
  providerName: string;
  description: string;
  skills: string[];
  taskTypes: TaskType[];
  languages: string[];
  operatingSystems: string[];
  tools: string[];
  requiredMcpServers: string[];
  pricingModel: "FIXED" | "HOURLY" | "FROM";
  basePriceCents: number;
  averageCompletionMinutes: number;
  completedTasks: number;
  verifiedSuccessRate: number;
  rating: number;
  workerStatus: "ONLINE" | "BUSY" | "OFFLINE";
  lastActiveAt: string;
  verificationStatus: "VERIFIED" | "PENDING" | "REJECTED" | "SUSPENDED";
  endpointType: "LOCAL_WORKER" | "WEBHOOK" | "A2A" | "DEMO";
  endpointUrl: string | null;
  authenticationType: "NONE" | "HMAC" | "API_KEY" | "OAUTH" | "A2A_METADATA";
  inputModes: string[];
  outputModes: string[];
  acceptingTasks: boolean;
  recentFailures: number;
  currentWorkload: number;
  maxConcurrentJobs: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerRecord {
  id: string;
  providerId: string;
  name: string;
  status: "ONLINE" | "BUSY" | "OFFLINE" | "SUSPENDED";
  os: "WINDOWS" | "MACOS" | "LINUX";
  installedTools: string[];
  mcpTools: string[];
  executors: string[];
  maxConcurrentJobs: number;
  activeJobs: number;
  lastHeartbeatAt: string;
  tokenHash: string | null;
  tokenId: string | null;
  acceptingJobs: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  customerId: string;
  title: string;
  problemDescription: string;
  desiredOutcome: string;
  repository: string;
  targetBranch: string;
  taskType: TaskType;
  requiredSkills: string[];
  requiredOperatingSystem: string | null;
  requiredTools: string[];
  requiredMcpTools: string[];
  budgetCents: number;
  deadline: string;
  acceptanceChecks: AcceptanceCheck[];
  securitySensitivity: "LOW" | "MEDIUM" | "HIGH";
  allowCodeChanges: boolean;
  allowPullRequest: boolean;
  requiresHumanApproval: boolean;
  preferredAgentId: string | null;
  status: TaskStatus;
  version: number;
  analysis: TaskAnalysis | null;
  matchedAgentId: string | null;
  assignedWorkerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  sequence: number;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  actorKind: string;
  actorId: string;
  reason: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MatchRecord {
  id: string;
  taskId: string;
  agentId: string;
  workerId: string;
  rank: number;
  totalScore: number;
  components: Record<string, number>;
  reasons: string[];
  eligible: boolean;
  createdAt: string;
}

export interface AssignmentRecord {
  id: string;
  taskId: string;
  agentId: string;
  providerId: string;
  workerId: string;
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "COMPLETED";
  quoteCents: number;
  providerEarningCents: number;
  platformFeeCents: number;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRunRecord {
  id: string;
  taskId: string;
  assignmentId: string;
  workerId: string;
  agentId: string;
  status: "QUEUED" | "RUNNING" | "SUBMITTED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  executor: "DEMO" | "CODEX" | "WEBHOOK";
  workflowTemplate: TaskType;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  commitShaBefore: string | null;
  commitShaAfter: string | null;
  leaseId: string | null;
  leaseTokenHash: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  id: string;
  jobRunId: string;
  sequence: number;
  kind: "STATUS" | "LOG" | "PROGRESS" | "FILE_CHANGE" | "TEST" | "BUILD" | "EVIDENCE";
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EvidenceArtifactRecord {
  id: string;
  taskId: string;
  workerId: string;
  jobRunId: string;
  artifactType: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storagePath: string;
  content: string;
  createdAt: string;
}

export interface VerificationResultRecord {
  id: string;
  taskId: string;
  jobRunId: string;
  checkId: string;
  checkType: string;
  status: "PASSED" | "FAILED" | "PENDING" | "ERROR";
  summary: string;
  observed: Record<string, unknown>;
  createdAt: string;
}

export interface LedgerEntryRecord {
  id: string;
  taskId: string | null;
  walletId: string;
  transactionKey: string;
  entryType: "RESERVE" | "RELEASE" | "REFUND" | "DISPUTE_HOLD" | "PLATFORM_FEE";
  amountCents: number;
  createdAt: string;
}

export interface WalletRecord {
  id: string;
  ownerId: string;
  kind: "CUSTOMER" | "PROVIDER" | "PLATFORM" | "ESCROW" | "DISPUTE";
  availableCents: number;
  reservedCents: number;
  pendingCents: number;
  updatedAt: string;
}

export interface DisputeRecord {
  id: string;
  taskId: string;
  openedBy: string;
  reason: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
  heldAmountCents: number;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorKind: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  success: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProfileRecord {
  id: string;
  name: string;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
  createdAt: string;
  updatedAt: string;
}

export interface TaskAggregate {
  task: TaskRecord;
  events: TaskEventRecord[];
  matches: Array<MatchRecord & { agent: AgentRecord }>;
  agent: AgentRecord | null;
  worker: WorkerRecord | null;
  assignment: AssignmentRecord | null;
  jobRun: JobRunRecord | null;
  jobEvents: JobEventRecord[];
  evidence: EvidenceArtifactRecord[];
  verificationResults: VerificationResultRecord[];
  ledgerEntries: LedgerEntryRecord[];
}

export interface DashboardSnapshot {
  taskCounts: Record<string, number>;
  tasks: TaskRecord[];
  customerWallet: WalletRecord;
  providerWallet: WalletRecord;
  platformWallet: WalletRecord;
  agents: AgentRecord[];
  workers: WorkerRecord[];
}
