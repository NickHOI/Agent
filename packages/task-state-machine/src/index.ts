import type {
  Actor,
  ActorKind,
  TaskStatus,
} from "@donelayer/shared";

export const taskTransitions = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["ANALYZING", "CANCELLED", "EXPIRED"],
  ANALYZING: ["MATCHING", "CANCELLED", "EXPIRED"],
  MATCHING: ["MATCHED", "CANCELLED", "EXPIRED"],
  MATCHED: ["AWAITING_PROVIDER", "MATCHING", "CANCELLED", "EXPIRED"],
  AWAITING_PROVIDER: ["ASSIGNED", "MATCHING", "CANCELLED", "EXPIRED"],
  ASSIGNED: ["RUNNING", "MATCHING", "CANCELLED", "EXPIRED"],
  RUNNING: ["SUBMITTED", "ASSIGNED", "CANCELLED", "EXPIRED"],
  SUBMITTED: ["VERIFYING"],
  VERIFYING: ["VERIFICATION_PASSED", "VERIFICATION_FAILED"],
  VERIFICATION_PASSED: ["CUSTOMER_REVIEW"],
  VERIFICATION_FAILED: ["ASSIGNED", "DISPUTED", "CANCELLED"],
  CUSTOMER_REVIEW: ["COMPLETED", "DISPUTED", "ASSIGNED"],
  DISPUTED: ["COMPLETED", "ASSIGNED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
} as const satisfies Readonly<Record<TaskStatus, readonly TaskStatus[]>>;

type TransitionKey = `${TaskStatus}:${TaskStatus}`;

const transitionActors = {
  "DRAFT:PUBLISHED": ["CUSTOMER", "ADMIN"],
  "DRAFT:CANCELLED": ["CUSTOMER", "ADMIN"],

  "PUBLISHED:ANALYZING": ["SYSTEM", "ADMIN"],
  "PUBLISHED:CANCELLED": ["CUSTOMER", "ADMIN"],
  "PUBLISHED:EXPIRED": ["SYSTEM", "ADMIN"],

  "ANALYZING:MATCHING": ["SYSTEM", "ADMIN"],
  "ANALYZING:CANCELLED": ["CUSTOMER", "ADMIN"],
  "ANALYZING:EXPIRED": ["SYSTEM", "ADMIN"],

  "MATCHING:MATCHED": ["SYSTEM", "ADMIN"],
  "MATCHING:CANCELLED": ["CUSTOMER", "ADMIN"],
  "MATCHING:EXPIRED": ["SYSTEM", "ADMIN"],

  "MATCHED:AWAITING_PROVIDER": ["SYSTEM", "ADMIN"],
  "MATCHED:MATCHING": ["SYSTEM", "ADMIN"],
  "MATCHED:CANCELLED": ["CUSTOMER", "ADMIN"],
  "MATCHED:EXPIRED": ["SYSTEM", "ADMIN"],

  "AWAITING_PROVIDER:ASSIGNED": ["PROVIDER", "ADMIN"],
  "AWAITING_PROVIDER:MATCHING": ["PROVIDER", "SYSTEM", "ADMIN"],
  "AWAITING_PROVIDER:CANCELLED": ["CUSTOMER", "ADMIN"],
  "AWAITING_PROVIDER:EXPIRED": ["SYSTEM", "ADMIN"],

  "ASSIGNED:RUNNING": ["WORKER", "SYSTEM", "ADMIN"],
  "ASSIGNED:MATCHING": ["SYSTEM", "ADMIN"],
  "ASSIGNED:CANCELLED": ["CUSTOMER", "ADMIN"],
  "ASSIGNED:EXPIRED": ["SYSTEM", "ADMIN"],

  "RUNNING:SUBMITTED": ["WORKER", "ADMIN"],
  "RUNNING:ASSIGNED": ["SYSTEM", "ADMIN"],
  "RUNNING:CANCELLED": ["CUSTOMER", "SYSTEM", "ADMIN"],
  "RUNNING:EXPIRED": ["SYSTEM", "ADMIN"],

  "SUBMITTED:VERIFYING": ["SYSTEM", "ADMIN"],
  "VERIFYING:VERIFICATION_PASSED": ["SYSTEM", "ADMIN"],
  "VERIFYING:VERIFICATION_FAILED": ["SYSTEM", "ADMIN"],
  "VERIFICATION_PASSED:CUSTOMER_REVIEW": ["SYSTEM", "ADMIN"],

  "VERIFICATION_FAILED:ASSIGNED": ["CUSTOMER", "SYSTEM", "ADMIN"],
  "VERIFICATION_FAILED:DISPUTED": ["CUSTOMER", "ADMIN"],
  "VERIFICATION_FAILED:CANCELLED": ["CUSTOMER", "ADMIN"],

  "CUSTOMER_REVIEW:COMPLETED": ["CUSTOMER", "ADMIN"],
  "CUSTOMER_REVIEW:DISPUTED": ["CUSTOMER", "ADMIN"],
  "CUSTOMER_REVIEW:ASSIGNED": ["CUSTOMER", "ADMIN"],

  "DISPUTED:COMPLETED": ["ADMIN"],
  "DISPUTED:ASSIGNED": ["ADMIN"],
  "DISPUTED:CANCELLED": ["ADMIN"],
} as const satisfies Partial<Record<TransitionKey, readonly ActorKind[]>>;

export const taskStateMachineErrorCodes = [
  "INVALID_TRANSITION",
  "FORBIDDEN_ACTOR",
  "ACTOR_ID_MISMATCH",
  "REASON_REQUIRED",
  "MISSING_ACTOR_RULE",
] as const;

export type TaskStateMachineErrorCode =
  (typeof taskStateMachineErrorCodes)[number];

export class TaskStateMachineError extends Error {
  readonly code: TaskStateMachineErrorCode;

  constructor(code: TaskStateMachineErrorCode, message: string) {
    super(message);
    this.name = "TaskStateMachineError";
    this.code = code;
  }
}

export interface TransitionActorContext {
  customerId?: string;
  providerId?: string;
  workerId?: string;
}

export interface ValidateTransitionInput {
  from: TaskStatus;
  to: TaskStatus;
  actor: Actor;
  reason: string;
  context: TransitionActorContext;
}

export interface TaskTransitionDecision extends ValidateTransitionInput {
  allowed: true;
}

export function getAllowedTransitions(status: TaskStatus): readonly TaskStatus[] {
  return taskTransitions[status];
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (taskTransitions[from] as readonly TaskStatus[]).includes(to);
}

export function getAuthorizedActorKinds(
  from: TaskStatus,
  to: TaskStatus,
): readonly ActorKind[] {
  if (!canTransition(from, to)) {
    return [];
  }

  return transitionActors[`${from}:${to}` as keyof typeof transitionActors] ?? [];
}

function assertActorIdentity(
  actor: Actor,
  context: TransitionActorContext,
): void {
  const expectedId =
    actor.kind === "CUSTOMER"
      ? context.customerId
      : actor.kind === "PROVIDER"
        ? context.providerId
        : actor.kind === "WORKER"
          ? context.workerId
          : undefined;

  if (
    actor.kind !== "ADMIN" &&
    actor.kind !== "SYSTEM" &&
    expectedId !== actor.id
  ) {
    throw new TaskStateMachineError(
      "ACTOR_ID_MISMATCH",
      `${actor.kind} ${actor.id} is not the actor assigned to this task`,
    );
  }
}

export function validateTransition(
  input: ValidateTransitionInput,
): TaskTransitionDecision {
  const reason = input.reason.trim();

  if (!reason) {
    throw new TaskStateMachineError(
      "REASON_REQUIRED",
      "Every task transition requires an audit reason",
    );
  }

  if (!canTransition(input.from, input.to)) {
    throw new TaskStateMachineError(
      "INVALID_TRANSITION",
      `Task cannot transition from ${input.from} to ${input.to}`,
    );
  }

  const authorizedKinds = getAuthorizedActorKinds(input.from, input.to);

  if (authorizedKinds.length === 0) {
    throw new TaskStateMachineError(
      "MISSING_ACTOR_RULE",
      `No actor rule is configured for ${input.from} to ${input.to}`,
    );
  }

  if (!authorizedKinds.includes(input.actor.kind)) {
    throw new TaskStateMachineError(
      "FORBIDDEN_ACTOR",
      `${input.actor.kind} cannot transition a task from ${input.from} to ${input.to}`,
    );
  }

  assertActorIdentity(input.actor, input.context);

  return {
    ...input,
    reason,
    allowed: true,
  };
}
