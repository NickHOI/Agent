import type {
  ExecutionResult,
  ExecutorKind,
  JobEnvelope,
  JobRunEventType,
  PermissionGuard,
} from "@donelayer/worker-protocol";

export type ExecutorProgressSink = (event: {
  type: JobRunEventType;
  message: string;
  progress?: number | undefined;
  data?: Record<string, unknown> | undefined;
}) => Promise<void>;

export type ExecutionContext = {
  job: JobEnvelope;
  workdir: string;
  permissionGuard: PermissionGuard;
  signal: AbortSignal;
  emit: ExecutorProgressSink;
};

export interface JobExecutor {
  readonly kind: ExecutorKind;
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
