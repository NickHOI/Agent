import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { z } from "zod";
import {
  assertRepositoryRelativePath,
  canonicalRepositoryJson,
  repositoryFileManifestSchema,
  repositoryManifestEntrySchema,
  repositoryManifestSha256,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

export const SOURCE_PACKAGE_FORMAT = "DONELAYER_SOURCE_PACKAGE_JSON_V1" as const;

export type SourcePackageLimits = {
  maxFileCount: number;
  maxDirectoryCount: number;
  maxPathDepth: number;
  maxFileBytes: number;
  maxTotalSourceBytes: number;
  maxPackageBytes: number;
  maxManifestBytes: number;
};

export const DEFAULT_SOURCE_PACKAGE_LIMITS: Readonly<SourcePackageLimits> = Object.freeze({
  maxFileCount: 1_000,
  maxDirectoryCount: 2_000,
  maxPathDepth: 32,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalSourceBytes: 4 * 1024 * 1024,
  maxPackageBytes: 8 * 1024 * 1024,
  maxManifestBytes: 2 * 1024 * 1024,
});

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const canonicalBase64Schema = z.string().max(16 * 1024 * 1024).regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  "Source package content must use canonical base64",
);

const sourcePackageEntrySchema = z.object({
  relative_path: z.string().min(1).max(1_024),
  content_base64: canonicalBase64Schema,
}).strict().superRefine((entry, context) => {
  addPathIssue(entry.relative_path, context, ["relative_path"]);
});

export const sourcePackageSchema = z.object({
  schemaVersion: z.literal(1),
  format: z.literal(SOURCE_PACKAGE_FORMAT),
  files: z.array(sourcePackageEntrySchema).min(1).max(100_000),
}).strict().superRefine((sourcePackage, context) => {
  addPathSetIssue(sourcePackage.files.map((entry) => entry.relative_path), context, ["files"]);
});

export const sourcePackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  format: z.literal(SOURCE_PACKAGE_FORMAT),
  remoteUrl: z.string().url().max(2_048),
  branch: z.string().min(1).max(255),
  commitSha: commitShaSchema,
  fileCount: z.number().int().positive().max(100_000),
  totalSourceBytes: z.number().int().nonnegative(),
  files: z.array(repositoryManifestEntrySchema).min(1).max(100_000),
  manifestSha256: sha256Schema,
  sourcePackageSha256: sha256Schema,
}).strict().superRefine((manifest, context) => {
  addPathSetIssue(manifest.files.map((entry) => entry.relative_path), context, ["files"]);
  if (manifest.fileCount !== manifest.files.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileCount"],
      message: "Source package file count does not match its entries",
    });
  }
  const totalSourceBytes = manifest.files.reduce((total, entry) => total + entry.size_bytes, 0);
  if (!Number.isSafeInteger(totalSourceBytes) || manifest.totalSourceBytes !== totalSourceBytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalSourceBytes"],
      message: "Source package total byte count does not match its entries",
    });
  }
  const repositoryManifest = repositoryFileManifestSchema.safeParse({
    schemaVersion: 1,
    remoteUrl: manifest.remoteUrl,
    branch: manifest.branch,
    commitSha: manifest.commitSha,
    files: manifest.files,
  });
  if (!repositoryManifest.success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: "Source package does not contain a valid repository file manifest",
    });
  }
});

export type SourcePackageManifest = z.infer<typeof sourcePackageManifestSchema>;

export type SourcePackageIdentity = {
  remoteUrl: string;
  branch: string;
  commitSha: string;
  manifestSha256: string;
  sourcePackageSha256: string;
  sourcePackageManifestSha256: string;
};

export type CreatedSourcePackage = {
  sourcePackageBytes: Buffer;
  sourcePackageSha256: string;
  sourcePackageManifest: SourcePackageManifest;
  sourcePackageManifestBytes: Buffer;
  sourcePackageManifestSha256: string;
  identity: SourcePackageIdentity;
};

export type VerifiedSourcePackageFile = {
  relativePath: string;
  bytes: Buffer;
};

export type VerifiedSourcePackage = {
  sourcePackageManifest: SourcePackageManifest;
  repositoryManifest: RepositoryFileManifest;
  files: VerifiedSourcePackageFile[];
  identity: SourcePackageIdentity;
};

export async function createSourcePackage(input: {
  repositoryRoot: string;
  repositoryManifest: RepositoryFileManifest;
  limits?: Partial<SourcePackageLimits>;
}): Promise<CreatedSourcePackage> {
  const limits = resolveLimits(input.limits);
  const repositoryManifest = repositoryFileManifestSchema.parse(input.repositoryManifest);
  assertPathSet(repositoryManifest.files.map((entry) => entry.relative_path));
  enforceEntryLimits(repositoryManifest.files, limits);

  const collectedFiles = await collectRepositoryFiles(input.repositoryRoot, limits);
  const observedEntries = collectedFiles.map((file) => file.entry);
  if (canonicalRepositoryJson(observedEntries) !== canonicalRepositoryJson(repositoryManifest.files)) {
    throw new Error("Repository working tree does not exactly match the verified file manifest");
  }

  const sourcePackage = sourcePackageSchema.parse({
    schemaVersion: 1,
    format: SOURCE_PACKAGE_FORMAT,
    files: collectedFiles.map((file) => ({
      relative_path: file.entry.relative_path,
      content_base64: file.bytes.toString("base64"),
    })),
  });
  const sourcePackageBytes = Buffer.from(canonicalRepositoryJson(sourcePackage), "utf8");
  assertByteLimit(sourcePackageBytes.byteLength, limits.maxPackageBytes, "Source package");
  const sourcePackageSha256 = sha256(sourcePackageBytes);
  const manifestSha256 = repositoryManifestSha256(repositoryManifest);
  const totalSourceBytes = repositoryManifest.files.reduce((total, entry) => total + entry.size_bytes, 0);
  const sourcePackageManifest = sourcePackageManifestSchema.parse({
    schemaVersion: 1,
    format: SOURCE_PACKAGE_FORMAT,
    remoteUrl: repositoryManifest.remoteUrl,
    branch: repositoryManifest.branch,
    commitSha: repositoryManifest.commitSha,
    fileCount: repositoryManifest.files.length,
    totalSourceBytes,
    files: repositoryManifest.files,
    manifestSha256,
    sourcePackageSha256,
  });
  const sourcePackageManifestBytes = Buffer.from(canonicalRepositoryJson(sourcePackageManifest), "utf8");
  assertByteLimit(sourcePackageManifestBytes.byteLength, limits.maxManifestBytes, "Source package manifest");
  const sourcePackageManifestSha256 = sha256(sourcePackageManifestBytes);
  const identity: SourcePackageIdentity = {
    remoteUrl: repositoryManifest.remoteUrl,
    branch: repositoryManifest.branch,
    commitSha: repositoryManifest.commitSha,
    manifestSha256,
    sourcePackageSha256,
    sourcePackageManifestSha256,
  };

  return {
    sourcePackageBytes,
    sourcePackageSha256,
    sourcePackageManifest,
    sourcePackageManifestBytes,
    sourcePackageManifestSha256,
    identity,
  };
}

export function verifySourcePackage(input: {
  sourcePackageBytes: Uint8Array;
  sourcePackageManifestBytes: Uint8Array;
  expected: SourcePackageIdentity;
  limits?: Partial<SourcePackageLimits>;
}): VerifiedSourcePackage {
  const limits = resolveLimits(input.limits);
  const sourcePackageBytes = Buffer.from(input.sourcePackageBytes);
  const sourcePackageManifestBytes = Buffer.from(input.sourcePackageManifestBytes);
  assertByteLimit(sourcePackageBytes.byteLength, limits.maxPackageBytes, "Source package");
  assertByteLimit(sourcePackageManifestBytes.byteLength, limits.maxManifestBytes, "Source package manifest");
  assertIdentity(input.expected);

  const observedPackageSha256 = sha256(sourcePackageBytes);
  const observedManifestFileSha256 = sha256(sourcePackageManifestBytes);
  assertDigest("Source package SHA-256", observedPackageSha256, input.expected.sourcePackageSha256);
  assertDigest(
    "Source package manifest file SHA-256",
    observedManifestFileSha256,
    input.expected.sourcePackageManifestSha256,
  );

  const sourcePackageManifest = sourcePackageManifestSchema.parse(
    parseCanonicalJson(sourcePackageManifestBytes, "Source package manifest"),
  );
  enforceEntryLimits(sourcePackageManifest.files, limits);
  assertIdentityMatch(sourcePackageManifest, input.expected);
  assertDigest(
    "Source package manifest repository digest",
    sourcePackageManifest.manifestSha256,
    input.expected.manifestSha256,
  );
  assertDigest(
    "Source package manifest package digest",
    sourcePackageManifest.sourcePackageSha256,
    observedPackageSha256,
  );

  const repositoryManifest = repositoryFileManifestSchema.parse({
    schemaVersion: 1,
    remoteUrl: sourcePackageManifest.remoteUrl,
    branch: sourcePackageManifest.branch,
    commitSha: sourcePackageManifest.commitSha,
    files: sourcePackageManifest.files,
  });
  assertDigest(
    "Repository file manifest SHA-256",
    repositoryManifestSha256(repositoryManifest),
    sourcePackageManifest.manifestSha256,
  );

  const sourcePackage = sourcePackageSchema.parse(
    parseCanonicalJson(sourcePackageBytes, "Source package"),
  );
  if (sourcePackage.files.length !== sourcePackageManifest.files.length) {
    throw new Error("Source package file set does not match its manifest");
  }

  let totalSourceBytes = 0;
  const files = sourcePackage.files.map((file, index): VerifiedSourcePackageFile => {
    const manifestEntry = sourcePackageManifest.files[index];
    if (!manifestEntry || file.relative_path !== manifestEntry.relative_path) {
      throw new Error("Source package file set does not match its manifest");
    }
    const bytes = decodeCanonicalBase64(file.content_base64);
    if (bytes.byteLength > limits.maxFileBytes) {
      throw new Error(`Source file ${file.relative_path} exceeds the configured byte limit`);
    }
    if (bytes.byteLength !== manifestEntry.size_bytes) {
      throw new Error(`Source file ${file.relative_path} size does not match its manifest`);
    }
    assertDigest(
      `Source file ${file.relative_path} SHA-256`,
      sha256(bytes),
      manifestEntry.sha256,
    );
    totalSourceBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > limits.maxTotalSourceBytes) {
      throw new Error("Source package exceeds the configured total source byte limit");
    }
    return { relativePath: file.relative_path, bytes };
  });
  if (totalSourceBytes !== sourcePackageManifest.totalSourceBytes) {
    throw new Error("Source package total byte count does not match its manifest");
  }

  return {
    sourcePackageManifest,
    repositoryManifest,
    files,
    identity: {
      remoteUrl: sourcePackageManifest.remoteUrl,
      branch: sourcePackageManifest.branch,
      commitSha: sourcePackageManifest.commitSha,
      manifestSha256: sourcePackageManifest.manifestSha256,
      sourcePackageSha256: observedPackageSha256,
      sourcePackageManifestSha256: observedManifestFileSha256,
    },
  };
}

export function assertSourcePackagePath(value: string): string {
  assertRepositoryRelativePath(value);
  if (value !== value.normalize("NFC")) {
    throw new Error("Source package path must use NFC Unicode normalization");
  }
  if (Buffer.byteLength(value, "utf8") > 1_024 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Source package path contains invalid or excessive bytes");
  }
  const segments = value.split("/");
  if (segments.length > 64) throw new Error("Source package path is too deep");
  for (const segment of segments) {
    if (
      segment !== segment.trim() ||
      segment.endsWith(".") ||
      Buffer.byteLength(segment, "utf8") > 255 ||
      /[<>:"|?*]/.test(segment)
    ) {
      throw new Error(`Source package path segment is not portable: ${segment}`);
    }
    const stem = segment.split(".", 1)[0]?.toUpperCase();
    if (stem && /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) {
      throw new Error(`Source package path uses a reserved device name: ${segment}`);
    }
  }
  assertPathIsNotSensitive(value);
  return value;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type CollectedFile = {
  entry: RepositoryFileManifest["files"][number];
  bytes: Buffer;
};

async function collectRepositoryFiles(
  repositoryRootInput: string,
  limits: SourcePackageLimits,
): Promise<CollectedFile[]> {
  const rootMetadata = await lstat(repositoryRootInput);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("Repository root must be a real directory, not a symlink");
  }
  const repositoryRoot = await realpath(repositoryRootInput);
  const files: CollectedFile[] = [];
  let directoryCount = 0;
  let totalSourceBytes = 0;

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    directoryCount += 1;
    if (directoryCount > limits.maxDirectoryCount) {
      throw new Error("Repository exceeds the configured directory limit");
    }
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      if (relativeDirectory === "" && child.name === ".git") {
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
          throw new Error("Repository .git metadata must be an ordinary directory");
        }
        continue;
      }
      const relativePath = assertSourcePackagePath(
        relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name,
      );
      const depth = relativePath.split("/").length;
      if (depth > limits.maxPathDepth) throw new Error(`Source package path exceeds the configured depth: ${relativePath}`);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error(`Repository symlink is forbidden: ${relativePath}`);
      if (metadata.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`Unsupported repository entry type: ${relativePath}`);
      if (files.length >= limits.maxFileCount) throw new Error("Repository exceeds the configured file count limit");
      if (metadata.size > limits.maxFileBytes) {
        throw new Error(`Source file ${relativePath} exceeds the configured byte limit`);
      }
      const resolved = await realpath(absolutePath);
      const relativeToRoot = path.relative(repositoryRoot, resolved);
      if (!relativeToRoot || relativeToRoot === ".." || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
        throw new Error(`Repository file resolved outside its root: ${relativePath}`);
      }
      const bytes = await readFile(resolved);
      totalSourceBytes += bytes.byteLength;
      if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > limits.maxTotalSourceBytes) {
        throw new Error("Repository exceeds the configured total source byte limit");
      }
      files.push({
        entry: {
          relative_path: relativePath,
          size_bytes: bytes.byteLength,
          sha256: sha256(bytes),
        },
        bytes,
      });
    }
  }

  await visit(repositoryRoot, "");
  files.sort((left, right) => left.entry.relative_path.localeCompare(right.entry.relative_path));
  assertPathSet(files.map((file) => file.entry.relative_path));
  if (files.length === 0) throw new Error("Source package cannot be empty");
  return files;
}

function assertPathIsNotSensitive(value: string): void {
  const segments = value.split("/");
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const fileName = lowerSegments.at(-1)!;
  const forbiddenDirectories = new Set([
    ".ssh",
    ".aws",
    ".azure",
    ".gcloud",
    ".vercel",
    ".codex",
    ".agents",
  ]);
  const forbiddenFiles = new Set([
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    ".pnpmrc",
    ".netrc",
    ".git-credentials",
    ".gitconfig",
    "credentials.json",
    "secrets.json",
    "secrets.yml",
    "secrets.yaml",
    ".ds_store",
    "thumbs.db",
    "desktop.ini",
  ]);
  if (
    lowerSegments.includes(".git") ||
    lowerSegments.some((segment) => segment === ".env" || segment.startsWith(".env.")) ||
    lowerSegments.some((segment) => forbiddenDirectories.has(segment)) ||
    forbiddenFiles.has(fileName) ||
    fileName.startsWith("id_rsa") ||
    fileName.startsWith("id_ed25519") ||
    /^(?:service[-_]account).*\.json$/.test(fileName) ||
    /\.(?:pem|key|p12|pfx)$/.test(fileName)
  ) {
    throw new Error(`Sensitive path is forbidden in a source package: ${value}`);
  }
}

function assertPathSet(paths: string[]): void {
  const filePaths = new Map<string, string>();
  const directoryPaths = new Map<string, string>();
  let previous: string | null = null;
  for (const value of paths) {
    const normalized = assertSourcePackagePath(value);
    if (previous !== null && previous.localeCompare(normalized) > 0) {
      throw new Error("Source package paths must be stably sorted");
    }
    previous = normalized;
    const segments = normalized.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const originalDirectory = segments.slice(0, index).join("/");
      const foldedDirectory = originalDirectory.normalize("NFC").toLowerCase();
      const fileCollision = filePaths.get(foldedDirectory);
      if (fileCollision) {
        throw new Error(`Source package file/directory prefix collision: ${fileCollision} and ${normalized}`);
      }
      const existingDirectory = directoryPaths.get(foldedDirectory);
      if (existingDirectory && existingDirectory !== originalDirectory) {
        throw new Error(`Source package path normalization collision: ${existingDirectory} and ${originalDirectory}`);
      }
      directoryPaths.set(foldedDirectory, originalDirectory);
    }
    const foldedFile = normalized.normalize("NFC").toLowerCase();
    const existingFile = filePaths.get(foldedFile);
    if (existingFile) throw new Error(`Source package path collision: ${existingFile} and ${normalized}`);
    const directoryCollision = directoryPaths.get(foldedFile);
    if (directoryCollision) {
      throw new Error(`Source package file/directory prefix collision: ${normalized} and ${directoryCollision}`);
    }
    filePaths.set(foldedFile, normalized);
  }
}

function enforceEntryLimits(
  entries: RepositoryFileManifest["files"],
  limits: SourcePackageLimits,
): void {
  if (entries.length > limits.maxFileCount) throw new Error("Source package exceeds the configured file count limit");
  let total = 0;
  for (const entry of entries) {
    if (entry.relative_path.split("/").length > limits.maxPathDepth) {
      throw new Error(`Source package path exceeds the configured depth: ${entry.relative_path}`);
    }
    if (entry.size_bytes > limits.maxFileBytes) {
      throw new Error(`Source file ${entry.relative_path} exceeds the configured byte limit`);
    }
    total += entry.size_bytes;
    if (!Number.isSafeInteger(total) || total > limits.maxTotalSourceBytes) {
      throw new Error("Source package exceeds the configured total source byte limit");
    }
  }
}

function addPathIssue(value: string, context: z.RefinementCtx, issuePath: PropertyKey[]): void {
  try {
    assertSourcePackagePath(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: issuePath,
      message: error instanceof Error ? error.message : "Source package path is invalid",
    });
  }
}

function addPathSetIssue(paths: string[], context: z.RefinementCtx, issuePath: PropertyKey[]): void {
  try {
    assertPathSet(paths);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: issuePath,
      message: error instanceof Error ? error.message : "Source package paths are invalid",
    });
  }
}

function resolveLimits(overrides: Partial<SourcePackageLimits> | undefined): SourcePackageLimits {
  const limits = { ...DEFAULT_SOURCE_PACKAGE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Source package limit ${name} must be a positive safe integer`);
  }
  if (limits.maxFileBytes > limits.maxTotalSourceBytes) {
    throw new Error("Source package per-file byte limit cannot exceed its total source byte limit");
  }
  return limits;
}

function assertByteLimit(observed: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(observed) || observed < 1 || observed > maximum) {
    throw new Error(`${label} exceeds the configured byte limit`);
  }
}

function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (canonicalRepositoryJson(value) !== text) throw new Error(`${label} is not canonically serialized`);
  return value;
}

function decodeCanonicalBase64(value: string): Buffer {
  if (!canonicalBase64Schema.safeParse(value).success) {
    throw new Error("Source package content is not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error("Source package content is not canonical base64");
  return bytes;
}

function assertIdentity(identity: SourcePackageIdentity): void {
  if (!identity.remoteUrl || !identity.branch || !commitShaSchema.safeParse(identity.commitSha).success) {
    throw new Error("Expected source package repository identity is invalid");
  }
  for (const digest of [
    identity.manifestSha256,
    identity.sourcePackageSha256,
    identity.sourcePackageManifestSha256,
  ]) {
    if (!sha256Schema.safeParse(digest).success) throw new Error("Expected source package SHA-256 is invalid");
  }
}

function assertIdentityMatch(manifest: SourcePackageManifest, expected: SourcePackageIdentity): void {
  if (
    manifest.remoteUrl !== expected.remoteUrl ||
    manifest.branch !== expected.branch ||
    manifest.commitSha !== expected.commitSha
  ) {
    throw new Error("Source package repository identity does not match the expected verified commit");
  }
}

function assertDigest(label: string, observed: string, expected: string): void {
  if (!safeEqualHex(observed, expected)) throw new Error(`${label} mismatch`);
}

function safeEqualHex(left: string, right: string): boolean {
  if (!sha256Schema.safeParse(left).success || !sha256Schema.safeParse(right).success) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
