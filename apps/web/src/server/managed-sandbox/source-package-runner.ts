import { z } from "zod";

import {
  BETA_GATE_3_PRODUCT_BRANCH,
  BETA_GATE_3_PRODUCT_REMOTE_URL,
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
} from "@donelayer/worker-protocol";

import {
  SOURCE_PACKAGE_FORMAT,
  type SourcePackageIdentity,
} from "./source-package";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);

export function managedBuildTestSourceRunner(input: {
  identity: SourcePackageIdentity;
  buildScriptPresent: boolean;
  allowedBranch?: string;
}): string {
  const allowedBranch = input.allowedBranch ?? REPOSITORY_MATERIALIZATION_BRANCH;
  const productSource = input.identity.remoteUrl === BETA_GATE_3_PRODUCT_REMOTE_URL;
  if (
    input.identity.branch !== allowedBranch ||
    (productSource && allowedBranch !== BETA_GATE_3_PRODUCT_BRANCH) ||
    (
      !productSource &&
      allowedBranch !== REPOSITORY_MATERIALIZATION_BRANCH &&
      allowedBranch !== REAL_SOURCE_BUG_FIXTURE_BRANCH &&
      !/^donelayer\/repair\/[a-z0-9](?:[a-z0-9-]{0,62})$/.test(allowedBranch)
    )
  ) {
    throw new Error("Source runner branch is outside the approved boundary");
  }
  const identity = {
    remoteUrl: z.union([
      z.literal(REPOSITORY_MATERIALIZATION_REMOTE_URL),
      z.literal(BETA_GATE_3_PRODUCT_REMOTE_URL),
    ]).parse(input.identity.remoteUrl),
    branch: z.literal(allowedBranch).parse(input.identity.branch),
    commitSha: commitShaSchema.parse(input.identity.commitSha),
    manifestSha256: sha256Schema.parse(input.identity.manifestSha256),
    sourcePackageSha256: sha256Schema.parse(input.identity.sourcePackageSha256),
    sourcePackageManifestSha256: sha256Schema.parse(input.identity.sourcePackageManifestSha256),
    buildScriptPresent: z.boolean().parse(input.buildScriptPresent),
  };

  return String.raw`import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "/vercel/sandbox";
const SOURCE = "/vercel/sandbox/source";
const PACKAGE_PATH = "/vercel/sandbox/source-package.json";
const MANIFEST_PATH = "/vercel/sandbox/source-package-manifest.json";
const PREPARE_RESULT = "/vercel/sandbox/source-package-verification.json";
const INTEGRITY_RESULT = "/vercel/sandbox/source-integrity-result.json";
const FORMAT = ${JSON.stringify(SOURCE_PACKAGE_FORMAT)};
const EXPECTED = Object.freeze(${JSON.stringify(identity)});
const MAX_FILE_COUNT = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const EXCLUDED_GENERATED_DIRECTORIES = new Set([
  "node_modules", "build", "dist", "coverage", "tmp", ".tmp", "logs", ".logs", ".next", "out"
]);

const mode = process.argv[2];
if (process.argv.length !== 3 || (mode !== "prepare" && mode !== "verify")) {
  throw new Error("Source package runner accepts only the fixed prepare or verify phase");
}

if (mode === "prepare") await prepare();
else await verifySourceIntegrity();

async function prepare() {
  const [packageBytes, manifestBytes] = await Promise.all([
    readFile(PACKAGE_PATH),
    readFile(MANIFEST_PATH),
  ]);
  assertEqual("source package SHA-256", sha256(packageBytes), EXPECTED.sourcePackageSha256);
  assertEqual("source package manifest SHA-256", sha256(manifestBytes), EXPECTED.sourcePackageManifestSha256);

  const manifest = parseCanonicalJson(manifestBytes, "source package manifest");
  assertExactKeys(manifest, [
    "branch", "commitSha", "fileCount", "files", "format", "manifestSha256", "remoteUrl",
    "schemaVersion", "sourcePackageSha256", "totalSourceBytes"
  ], "source package manifest");
  if (
    manifest.schemaVersion !== 1 || manifest.format !== FORMAT ||
    manifest.remoteUrl !== EXPECTED.remoteUrl || manifest.branch !== EXPECTED.branch ||
    manifest.commitSha !== EXPECTED.commitSha || manifest.manifestSha256 !== EXPECTED.manifestSha256 ||
    manifest.sourcePackageSha256 !== EXPECTED.sourcePackageSha256
  ) {
    throw new Error("Source package manifest identity does not match the locked expected commit");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > MAX_FILE_COUNT) {
    throw new Error("Source package manifest file count is invalid");
  }
  if (manifest.fileCount !== manifest.files.length) throw new Error("Source package manifest count mismatch");
  assertPathSet(manifest.files.map((entry) => entry?.relative_path));

  let manifestTotalBytes = 0;
  for (const entry of manifest.files) {
    assertExactKeys(entry, ["relative_path", "sha256", "size_bytes"], "source package manifest entry");
    assertSourcePath(entry.relative_path);
    if (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0 || entry.size_bytes > MAX_FILE_BYTES) {
      throw new Error("Source package manifest contains an invalid file size");
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Source package manifest contains an invalid file hash");
    manifestTotalBytes += entry.size_bytes;
    if (!Number.isSafeInteger(manifestTotalBytes) || manifestTotalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Source package manifest exceeds the source byte limit");
    }
  }
  if (manifest.totalSourceBytes !== manifestTotalBytes) throw new Error("Source package manifest byte count mismatch");

  const repositoryManifest = {
    schemaVersion: 1,
    remoteUrl: manifest.remoteUrl,
    branch: manifest.branch,
    commitSha: manifest.commitSha,
    files: manifest.files,
  };
  assertEqual("repository manifest SHA-256", sha256(Buffer.from(canonicalJson(repositoryManifest))), EXPECTED.manifestSha256);

  const sourcePackage = parseCanonicalJson(packageBytes, "source package");
  assertExactKeys(sourcePackage, ["files", "format", "schemaVersion"], "source package");
  if (sourcePackage.schemaVersion !== 1 || sourcePackage.format !== FORMAT || !Array.isArray(sourcePackage.files)) {
    throw new Error("Source package format is invalid");
  }
  if (sourcePackage.files.length !== manifest.files.length) throw new Error("Source package file set mismatch");
  assertPathSet(sourcePackage.files.map((entry) => entry?.relative_path));

  await mkdir(SOURCE, { recursive: false, mode: 0o700 });
  let extractedBytes = 0;
  for (let index = 0; index < sourcePackage.files.length; index += 1) {
    const file = sourcePackage.files[index];
    const expected = manifest.files[index];
    assertExactKeys(file, ["content_base64", "relative_path"], "source package entry");
    if (file.relative_path !== expected.relative_path) throw new Error("Source package ordering mismatch");
    const bytes = decodeCanonicalBase64(file.content_base64);
    if (bytes.byteLength !== expected.size_bytes) throw new Error("Source package file size mismatch");
    assertEqual("source file SHA-256", sha256(bytes), expected.sha256);
    extractedBytes += bytes.byteLength;
    if (extractedBytes > MAX_TOTAL_BYTES) throw new Error("Extracted source exceeds the byte limit");
    const destination = safeDestination(file.relative_path);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
  }

  const packageJson = JSON.parse(await readFile(path.join(SOURCE, "package.json"), "utf8"));
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    throw new Error("Fixture package.json is invalid");
  }
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts) || typeof scripts.test !== "string" || !scripts.test.trim()) {
    throw new Error("Fixture must contain a fixed test script");
  }
  const lifecycleScripts = ["preinstall", "install", "postinstall", "prepare"].filter(
    (name) => typeof scripts[name] === "string" && scripts[name].trim().length > 0,
  );
  if (lifecycleScripts.length > 0) throw new Error("Fixture contains a forbidden install lifecycle script");
  const buildScriptPresent = typeof scripts.build === "string" && scripts.build.trim().length > 0;
  if (buildScriptPresent !== EXPECTED.buildScriptPresent) throw new Error("Fixture build-script presence changed after materialization");
  const credentialEnvironmentNames = Object.keys(process.env).filter((name) =>
    /^(?:GITHUB_TOKEN|GH_TOKEN|VERCEL_TOKEN|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY)$/i.test(name)
  );
  if (credentialEnvironmentNames.length > 0) throw new Error("Credential environment reached the managed workload");

  const npm = spawnSync("npm", ["--version"], {
    cwd: SOURCE,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (npm.error) throw npm.error;
  if (npm.status !== 0 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test((npm.stdout ?? "").trim())) {
    throw new Error("Sandbox npm version could not be verified");
  }

  const result = {
    schemaVersion: 1,
    repositoryUrl: EXPECTED.remoteUrl,
    branch: EXPECTED.branch,
    commitSha: EXPECTED.commitSha,
    manifestSha256: EXPECTED.manifestSha256,
    sourcePackageManifestSha256: EXPECTED.sourcePackageManifestSha256,
    sourcePackageSha256: EXPECTED.sourcePackageSha256,
    fileCount: manifest.files.length,
    totalSourceBytes: manifest.totalSourceBytes,
    packageVerified: true,
    manifestVerified: true,
    commitVerified: true,
    extracted: true,
    nodeVersion: process.version,
    npmVersion: npm.stdout.trim(),
    buildScriptPresent,
    installLifecycleScriptsPresent: false,
    credentialEnvironmentNames,
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(PREPARE_RESULT, canonicalJson(result), { mode: 0o600, flag: "wx" });
  process.stdout.write("SOURCE_PACKAGE_VERIFIED\n");
}

async function verifySourceIntegrity() {
  const manifest = parseCanonicalJson(await readFile(MANIFEST_PATH), "source package manifest");
  const expectedByPath = new Map(manifest.files.map((entry) => [entry.relative_path, entry]));
  const missing = [];
  const modified = [];
  for (const [relativePath, entry] of expectedByPath) {
    try {
      const bytes = await readFile(safeDestination(relativePath));
      if (bytes.byteLength !== entry.size_bytes || sha256(bytes) !== entry.sha256) modified.push(relativePath);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") missing.push(relativePath);
      else throw error;
    }
  }

  const added = [];
  async function visit(directory, relativeDirectory = "") {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = relativeDirectory ? relativeDirectory + "/" + child.name : child.name;
      assertSourcePath(relativePath);
      const absolutePath = safeDestination(relativePath);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        added.push(relativePath);
        continue;
      }
      if (metadata.isDirectory()) {
        const top = relativePath.split("/", 1)[0].toLowerCase();
        if (!EXCLUDED_GENERATED_DIRECTORIES.has(top)) await visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        added.push(relativePath);
        continue;
      }
      if (!expectedByPath.has(relativePath)) added.push(relativePath);
    }
  }
  await visit(SOURCE);

  const sourceMutationDetected = missing.length > 0 || modified.length > 0 || added.length > 0;
  const result = {
    schemaVersion: 1,
    commitSha: EXPECTED.commitSha,
    manifestSha256: EXPECTED.manifestSha256,
    checkedFileCount: expectedByPath.size,
    missing,
    modified,
    added,
    sourceMutationDetected,
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(INTEGRITY_RESULT, canonicalJson(result), { mode: 0o600, flag: "wx" });
  process.stdout.write(sourceMutationDetected ? "SOURCE_MUTATION_DETECTED\n" : "SOURCE_INTEGRITY_VERIFIED\n");
  if (sourceMutationDetected) process.exitCode = 42;
}

function parseCanonicalJson(bytes, label) {
  const text = Buffer.from(bytes).toString("utf8");
  const value = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new Error(label + " is not canonically serialized");
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  throw new Error("Canonical JSON contains an unsupported value");
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " must be an object");
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label + " contains unsupported fields");
}

function assertPathSet(paths) {
  const folded = new Set();
  let previous = null;
  for (const candidate of paths) {
    const value = assertSourcePath(candidate);
    if (previous !== null && previous.localeCompare(value) > 0) throw new Error("Source package paths are not sorted");
    previous = value;
    const key = value.normalize("NFC").toLowerCase();
    if (folded.has(key)) throw new Error("Source package path collision");
    folded.add(key);
    const segments = value.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (folded.has(segments.slice(0, index).join("/").toLowerCase())) throw new Error("Source package file/directory collision");
    }
  }
}

function assertSourcePath(value) {
  if (typeof value !== "string" || !value || value !== value.normalize("NFC") || value.includes("\\") || value.startsWith("/") || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Source package path is invalid");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment !== segment.trim() || segment.endsWith("."))) {
    throw new Error("Source package path traversal is forbidden");
  }
  const lower = segments.map((segment) => segment.toLowerCase());
  const fileName = lower.at(-1);
  const secretDirectories = new Set([".git", ".ssh", ".aws", ".azure", ".gcloud", ".vercel", ".codex", ".agents"]);
  const secretFiles = new Set([".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmrc", ".netrc", ".git-credentials", ".gitconfig", "credentials.json", "secrets.json", "secrets.yml", "secrets.yaml"]);
  if (
    lower.some((segment) => secretDirectories.has(segment) || segment === ".env" || segment.startsWith(".env.")) ||
    secretFiles.has(fileName) || fileName.startsWith("id_rsa") || fileName.startsWith("id_ed25519") ||
    /\.(?:pem|key|p12|pfx)$/.test(fileName)
  ) throw new Error("Sensitive source package path is forbidden");
  return value;
}

function safeDestination(relativePath) {
  assertSourcePath(relativePath);
  const destination = path.resolve(SOURCE, ...relativePath.split("/"));
  if (destination !== SOURCE && !destination.startsWith(SOURCE + path.sep)) throw new Error("Source path escaped the workspace");
  return destination;
}

function decodeCanonicalBase64(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Source package content is not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.byteLength > MAX_FILE_BYTES) throw new Error("Source package content is invalid");
  return bytes;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertEqual(label, observed, expected) {
  if (observed !== expected) throw new Error(label + " mismatch");
}
`;
}
