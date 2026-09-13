import type {
  AgentIdentityProfile,
  DemoStore,
  PublicJobReceipt,
} from "@donelayer/database";

const verifiedWorkResults = new Set<PublicJobReceipt["result"]>([
  "VERIFIED",
  "VERIFIED_DELIVERY",
  "CONTRACT_VERIFIED_DELIVERY",
]);

const workReceiptTypes = new Set<PublicJobReceipt["taskType"]>([
  "Agent Repair in Managed Sandbox Verification",
  "GitHub Delivery and Independent Verification",
  "Semantic Contract Verification and GitHub Delivery",
]);

export type AgentTrustProfile = {
  identity: AgentIdentityProfile;
  activeAuthorities: Array<{
    taskId: string;
    taskTitle: string;
    leaseId: string;
    expiresAt: string;
    allowedActions: string[];
    deniedActions: string[];
  }>;
  verifiedWork: Array<{
    taskId: string;
    taskTitle: string;
    receiptPublicId: string;
    receiptType: PublicJobReceipt["taskType"];
    result: PublicJobReceipt["result"];
    createdAt: string;
    reputationQualification: "NOT_EVALUATED";
  }>;
};

export function buildAgentTrustProfile(
  store: Pick<DemoStore, "getAgentIdentityProfile" | "listTasks" | "getTaskAggregate" | "getPublicJobReceipt">,
  agentId: string,
  observedAt = new Date(),
): AgentTrustProfile | null {
  const identity = store.getAgentIdentityProfile(agentId);
  if (!identity) return null;
  const aggregates = store.listTasks()
    .map((task) => store.getTaskAggregate(task.id))
    .filter((aggregate) => aggregate.assignment?.agentId === agentId || aggregate.jobRun?.agentId === agentId);

  const activeAuthorities = aggregates.flatMap((aggregate) => {
    const lease = aggregate.permissionLease;
    if (
      !lease ||
      lease.agentId !== agentId ||
      lease.status !== "ACTIVE" ||
      !lease.expiresAt ||
      Date.parse(lease.expiresAt) <= observedAt.getTime()
    ) return [];
    return [{
      taskId: aggregate.task.id,
      taskTitle: aggregate.task.title,
      leaseId: lease.id,
      expiresAt: lease.expiresAt,
      allowedActions: [...lease.scope.allowedActions],
      deniedActions: [...lease.scope.deniedActions],
    }];
  });

  const verifiedWork = aggregates.flatMap((aggregate) => {
    const receipt = aggregate.receipt;
    if (!receipt) return [];
    let publicReceipt: PublicJobReceipt | null;
    try {
      publicReceipt = store.getPublicJobReceipt(receipt.receiptPublicId);
    } catch {
      return [];
    }
    if (!publicReceipt || !isPresentableVerifiedWork(publicReceipt)) return [];
    return [{
      taskId: aggregate.task.id,
      taskTitle: aggregate.task.title,
      receiptPublicId: publicReceipt.publicReceiptId,
      receiptType: publicReceipt.taskType,
      result: publicReceipt.result,
      createdAt: publicReceipt.createdAt,
      reputationQualification: "NOT_EVALUATED" as const,
    }];
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return { identity, activeAuthorities, verifiedWork };
}

export function isPresentableVerifiedWork(
  receipt: Pick<PublicJobReceipt, "taskType" | "result" | "verificationStatus" | "invalidated" | "disputed">,
): boolean {
  return receipt.verificationStatus === "VALID" &&
    !receipt.invalidated &&
    !receipt.disputed &&
    verifiedWorkResults.has(receipt.result) &&
    workReceiptTypes.has(receipt.taskType);
}
