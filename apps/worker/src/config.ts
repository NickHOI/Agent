import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const workerConfigSchema = z.object({
  apiUrl: z.string().url(),
  workerId: z.string().uuid(),
  name: z.string().min(1),
  pairedAt: z.string().datetime({ offset: true }),
  pollIntervalMs: z.number().int().min(500).max(60_000).default(2_000),
});

const credentialSchema = z.object({
  workerToken: z.string().min(32),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export class WorkerConfigStore {
  readonly directory: string;
  readonly usesDevelopmentCredentialStore = true;

  constructor(directory = defaultConfigDirectory()) {
    this.directory = path.resolve(directory);
  }

  async save(config: WorkerConfig, workerToken: string): Promise<void> {
    const parsedConfig = workerConfigSchema.parse(config);
    const parsedCredential = credentialSchema.parse({ workerToken });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicWriteJson(path.join(this.directory, "config.json"), parsedConfig);
    await atomicWriteJson(path.join(this.directory, "credentials.json"), parsedCredential);
    await bestEffortPrivatePermissions(path.join(this.directory, "credentials.json"));
  }

  async loadConfig(): Promise<WorkerConfig | null> {
    return readValidatedJson(path.join(this.directory, "config.json"), workerConfigSchema);
  }

  async loadToken(): Promise<string | null> {
    const credentials = await readValidatedJson(
      path.join(this.directory, "credentials.json"),
      credentialSchema,
    );
    return credentials?.workerToken ?? null;
  }

  async clear(): Promise<void> {
    await Promise.all([
      rm(path.join(this.directory, "config.json"), { force: true }),
      rm(path.join(this.directory, "credentials.json"), { force: true }),
    ]);
  }
}

export function defaultConfigDirectory(): string {
  return process.env.DONELAYER_WORKER_CONFIG_DIR?.trim() || path.join(homedir(), ".donelayer-worker");
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readValidatedJson<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw new Error(`Worker configuration at ${filePath} is invalid`, { cause: error });
  }
}

async function bestEffortPrivatePermissions(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await chmod(filePath, 0o600);
  }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
