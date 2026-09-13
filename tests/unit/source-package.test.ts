import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  canonicalRepositoryJson,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";
import {
  SOURCE_PACKAGE_FORMAT,
  assertSourcePackagePath,
  createSourcePackage,
  sha256,
  sourcePackageManifestSchema,
  sourcePackageSchema,
  verifySourcePackage,
  type CreatedSourcePackage,
} from "../../apps/web/src/server/managed-sandbox/source-package";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

describe("Managed Sandbox source package", () => {
  it("creates deterministic canonical bytes and verifies an exact roundtrip", async () => {
    const repositoryRoot = await fixtureRepository();
    await mkdir(path.join(repositoryRoot, ".git"));
    await writeFile(path.join(repositoryRoot, ".git", "config"), "credential = must-not-leak\n");
    const repositoryManifest = await manifestFor(repositoryRoot, ["package.json", "src/add.ts"]);

    const first = await createSourcePackage({ repositoryRoot, repositoryManifest });
    const second = await createSourcePackage({ repositoryRoot, repositoryManifest });
    const verified = verifySourcePackage({
      sourcePackageBytes: first.sourcePackageBytes,
      sourcePackageManifestBytes: first.sourcePackageManifestBytes,
      expected: first.identity,
    });

    expect(first.sourcePackageBytes.equals(second.sourcePackageBytes)).toBe(true);
    expect(first.sourcePackageManifestBytes.equals(second.sourcePackageManifestBytes)).toBe(true);
    expect(first.identity).toEqual(second.identity);
    expect(first.sourcePackageManifest).toMatchObject({
      schemaVersion: 1,
      format: SOURCE_PACKAGE_FORMAT,
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: REPOSITORY_MATERIALIZATION_BRANCH,
      commitSha: "a".repeat(40),
      fileCount: 2,
      manifestSha256: repositoryManifestSha256(repositoryManifest),
      sourcePackageSha256: sha256(first.sourcePackageBytes),
    });
    expect(first.sourcePackageManifestSha256).toBe(sha256(first.sourcePackageManifestBytes));
    expect(verified.identity).toEqual(first.identity);
    expect(verified.repositoryManifest).toEqual(repositoryManifest);
    expect(verified.files.map((file) => file.relativePath)).toEqual(["package.json", "src/add.ts"]);
    expect(verified.files.map((file) => file.bytes.toString("utf8"))).toEqual([
      "{\"name\":\"fixture\",\"private\":true}\n",
      "export const add = (a: number, b: number) => a + b;\n",
    ]);
    expect(first.sourcePackageBytes.toString("utf8")).not.toContain("credential = must-not-leak");
    expect(first.sourcePackageBytes.toString("utf8")).toBe(
      canonicalRepositoryJson(JSON.parse(first.sourcePackageBytes.toString("utf8")) as unknown),
    );
  });

  it("rejects sensitive, non-portable, traversal, and ambiguous paths", () => {
    for (const rejected of [
      ".git/config",
      "../secret",
      "/absolute",
      "src\\file.ts",
      ".env",
      ".env.production",
      "config/.npmrc",
      ".ssh/id_ed25519",
      ".aws/credentials",
      ".vercel/project.json",
      ".codex/config.toml",
      ".agents/skills.txt",
      "keys/server.pem",
      "keys/server.key",
      "credentials.json",
      "service-account-prod.json",
      "CON.txt",
      "folder/trailing. ",
      `src/cafe\u0301.ts`,
    ]) {
      expect(() => assertSourcePackagePath(rejected), rejected).toThrow();
    }

    expect(sourcePackageSchema.safeParse({
      schemaVersion: 1,
      format: SOURCE_PACKAGE_FORMAT,
      files: [
        { relative_path: "src/A.ts", content_base64: "YQ==" },
        { relative_path: "src/a.ts", content_base64: "Yg==" },
      ],
    }).success).toBe(false);
    expect(sourcePackageSchema.safeParse({
      schemaVersion: 1,
      format: SOURCE_PACKAGE_FORMAT,
      files: [
        { relative_path: "src", content_base64: "YQ==" },
        { relative_path: "src/a.ts", content_base64: "Yg==" },
      ],
    }).success).toBe(false);
    expect(sourcePackageSchema.safeParse({
      schemaVersion: 1,
      format: SOURCE_PACKAGE_FORMAT,
      files: [{ relative_path: "src/a.ts", content_base64: "YQ" }],
    }).success).toBe(false);
  });

  it("fails closed when the working tree differs, contains a secret, or contains a symlink", async () => {
    const mutatedRoot = await fixtureRepository();
    const mutatedManifest = await manifestFor(mutatedRoot, ["package.json", "src/add.ts"]);
    await writeFile(path.join(mutatedRoot, "src", "add.ts"), "export const add = () => 99;\n");
    await expect(createSourcePackage({ repositoryRoot: mutatedRoot, repositoryManifest: mutatedManifest }))
      .rejects.toThrow(/does not exactly match/i);

    const secretRoot = await fixtureRepository();
    await writeFile(path.join(secretRoot, ".env.local"), "TOKEN=not-for-packaging\n");
    const secretManifest = await manifestFor(secretRoot, [".env.local", "package.json", "src/add.ts"]);
    await expect(createSourcePackage({ repositoryRoot: secretRoot, repositoryManifest: secretManifest }))
      .rejects.toThrow(/sensitive path/i);

    const linkedRoot = await fixtureRepository();
    const linkedManifest = await manifestFor(linkedRoot, ["package.json", "src/add.ts"]);
    const outside = await temporaryDirectory("donelayer-source-outside-");
    await writeFile(path.join(outside, "secret.txt"), "outside\n");
    await symlink(outside, path.join(linkedRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(createSourcePackage({ repositoryRoot: linkedRoot, repositoryManifest: linkedManifest }))
      .rejects.toThrow(/symlink/i);
  });

  it("rejects package, manifest, commit, file-content, and file-set tampering", async () => {
    const repositoryRoot = await fixtureRepository();
    const repositoryManifest = await manifestFor(repositoryRoot, ["package.json", "src/add.ts"]);
    const created = await createSourcePackage({ repositoryRoot, repositoryManifest });

    const changedPackageBytes = Buffer.from(created.sourcePackageBytes);
    const changedPackageIndex = changedPackageBytes.length - 2;
    changedPackageBytes[changedPackageIndex] = changedPackageBytes[changedPackageIndex]! ^ 1;
    expect(() => verifySourcePackage({
      sourcePackageBytes: changedPackageBytes,
      sourcePackageManifestBytes: created.sourcePackageManifestBytes,
      expected: created.identity,
    })).toThrow(/package SHA-256.*mismatch/i);

    expect(() => verifySourcePackage({
      sourcePackageBytes: created.sourcePackageBytes,
      sourcePackageManifestBytes: created.sourcePackageManifestBytes,
      expected: { ...created.identity, commitSha: "b".repeat(40) },
    })).toThrow(/identity.*verified commit/i);

    const changedContent = rewritePackage(created, (sourcePackage) => {
      sourcePackage.files[0]!.content_base64 = Buffer.from("different bytes\n").toString("base64");
    });
    expect(() => verifySourcePackage(changedContent)).toThrow(/size does not match|SHA-256.*mismatch/i);

    const extraFile = rewritePackage(created, (sourcePackage) => {
      sourcePackage.files.push({ relative_path: "zzz.txt", content_base64: "eg==" });
    });
    expect(() => verifySourcePackage(extraFile)).toThrow(/file set does not match/i);

    const changedManifestBytes = Buffer.from(created.sourcePackageManifestBytes);
    const changedManifestIndex = changedManifestBytes.length - 2;
    changedManifestBytes[changedManifestIndex] = changedManifestBytes[changedManifestIndex]! ^ 1;
    expect(() => verifySourcePackage({
      sourcePackageBytes: created.sourcePackageBytes,
      sourcePackageManifestBytes: changedManifestBytes,
      expected: created.identity,
    })).toThrow(/manifest file SHA-256.*mismatch/i);
  });

  it("requires strict canonical JSON and enforces file, total, package, and manifest limits", async () => {
    const repositoryRoot = await fixtureRepository();
    const repositoryManifest = await manifestFor(repositoryRoot, ["package.json", "src/add.ts"]);
    const created = await createSourcePackage({ repositoryRoot, repositoryManifest });
    const prettyPackageBytes = Buffer.from(`${JSON.stringify(JSON.parse(created.sourcePackageBytes.toString("utf8")), null, 2)}\n`);
    const prettyInput = rewritePackageBytes(created, prettyPackageBytes);
    expect(() => verifySourcePackage(prettyInput)).toThrow(/not canonically serialized/i);

    await expect(createSourcePackage({
      repositoryRoot,
      repositoryManifest,
      limits: { maxFileBytes: 20, maxTotalSourceBytes: 100 },
    })).rejects.toThrow(/file .* byte limit/i);
    await expect(createSourcePackage({
      repositoryRoot,
      repositoryManifest,
      limits: { maxFileBytes: 100, maxTotalSourceBytes: 60 },
    })).rejects.toThrow(/total source byte limit/i);
    await expect(createSourcePackage({
      repositoryRoot,
      repositoryManifest,
      limits: { maxFileBytes: 100, maxTotalSourceBytes: 100, maxPackageBytes: 10 },
    })).rejects.toThrow(/Source package exceeds.*byte limit/i);
    await expect(createSourcePackage({
      repositoryRoot,
      repositoryManifest,
      limits: { maxFileBytes: 100, maxTotalSourceBytes: 100, maxManifestBytes: 10 },
    })).rejects.toThrow(/manifest exceeds.*byte limit/i);
  });

  it("keeps the manifest schema strict and bound to the repository manifest digest", async () => {
    const repositoryRoot = await fixtureRepository();
    const repositoryManifest = await manifestFor(repositoryRoot, ["package.json", "src/add.ts"]);
    const created = await createSourcePackage({ repositoryRoot, repositoryManifest });
    const manifest = JSON.parse(created.sourcePackageManifestBytes.toString("utf8")) as Record<string, unknown>;

    expect(sourcePackageManifestSchema.safeParse({ ...manifest, unexpected: true }).success).toBe(false);
    expect(sourcePackageManifestSchema.safeParse({ ...manifest, fileCount: 3 }).success).toBe(false);
    expect(sourcePackageManifestSchema.safeParse({ ...manifest, totalSourceBytes: 1 }).success).toBe(false);

    const changed = { ...manifest, manifestSha256: "f".repeat(64) };
    const manifestBytes = Buffer.from(canonicalRepositoryJson(changed));
    expect(() => verifySourcePackage({
      sourcePackageBytes: created.sourcePackageBytes,
      sourcePackageManifestBytes: manifestBytes,
      expected: {
        ...created.identity,
        sourcePackageManifestSha256: sha256(manifestBytes),
      },
    })).toThrow(/repository digest.*mismatch/i);
  });
});

async function fixtureRepository(): Promise<string> {
  const repositoryRoot = await temporaryDirectory("donelayer-source-package-");
  await mkdir(path.join(repositoryRoot, "src"));
  await writeFile(path.join(repositoryRoot, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");
  await writeFile(path.join(repositoryRoot, "src", "add.ts"), "export const add = (a: number, b: number) => a + b;\n");
  return repositoryRoot;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

async function manifestFor(repositoryRoot: string, paths: string[]): Promise<RepositoryFileManifest> {
  const entries = await Promise.all(paths.map(async (relativePath) => {
    const bytes = await readFile(path.join(repositoryRoot, ...relativePath.split("/")));
    return {
      relative_path: relativePath,
      size_bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
  entries.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return repositoryFileManifestSchema.parse({
    schemaVersion: 1,
    remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
    branch: REPOSITORY_MATERIALIZATION_BRANCH,
    commitSha: "a".repeat(40),
    files: entries,
  });
}

function rewritePackage(
  created: CreatedSourcePackage,
  mutate: (sourcePackage: { files: Array<{ relative_path: string; content_base64: string }> }) => void,
) {
  const sourcePackage = JSON.parse(created.sourcePackageBytes.toString("utf8")) as {
    files: Array<{ relative_path: string; content_base64: string }>;
  };
  mutate(sourcePackage);
  const sourcePackageBytes = Buffer.from(canonicalRepositoryJson(sourcePackage));
  return rewritePackageBytes(created, sourcePackageBytes);
}

function rewritePackageBytes(created: CreatedSourcePackage, sourcePackageBytes: Buffer) {
  const sourcePackageManifest = JSON.parse(created.sourcePackageManifestBytes.toString("utf8")) as Record<string, unknown>;
  sourcePackageManifest.sourcePackageSha256 = sha256(sourcePackageBytes);
  const sourcePackageManifestBytes = Buffer.from(canonicalRepositoryJson(sourcePackageManifest));
  return {
    sourcePackageBytes,
    sourcePackageManifestBytes,
    expected: {
      ...created.identity,
      sourcePackageSha256: sha256(sourcePackageBytes),
      sourcePackageManifestSha256: sha256(sourcePackageManifestBytes),
    },
  };
}
