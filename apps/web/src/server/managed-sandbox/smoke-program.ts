export const managedSandboxSmokeProgram = String.raw`
import { access, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import process from "node:process";

const startedAt = new Date().toISOString();

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function probeNetwork() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = https.get("https://example.com/", { timeout: 1500 }, (response) => {
      response.resume();
      finish({ blocked: false, outcome: "unexpected-success", statusCode: response.statusCode ?? null });
    });
    request.once("timeout", () => request.destroy(new Error("NETWORK_PROBE_TIMEOUT")));
    request.once("error", (error) => finish({ blocked: true, outcome: "blocked", errorCode: error.code ?? error.message }));
  });
}

const networkProbe = await probeNetwork();
const credentialLikeEnvironmentNames = Object.keys(process.env)
  .filter((name) => /(TOKEN|SECRET|CREDENTIAL|PASSWORD|API_KEY|ACCESS_KEY)/i.test(name))
  .sort();
const localHostExposure = {
  repositoryGitPresent: await exists("/vercel/sandbox/.git"),
  repositoryAgentRulesPresent: await exists("/vercel/sandbox/AGENTS.md"),
  repositoryPackagePresent: await exists("/vercel/sandbox/package.json"),
  localEnvironmentFilePresent: await exists("/vercel/sandbox/.env.local"),
  windowsDriveMountPresent: (await exists("/mnt/c/Users")) || (await exists("/c/Users")),
  credentialLikeEnvironmentNames,
};
const finishedAt = new Date().toISOString();
const proof = {
  schemaVersion: 1,
  jobId: process.env.DONELAYER_JOB_ID,
  sandboxRunId: process.env.DONELAYER_SANDBOX_RUN_ID,
  provider: "VERCEL_SANDBOX",
  hostname: os.hostname(),
  nodeVersion: process.version,
  platform: process.platform,
  architecture: process.arch,
  cwd: process.cwd(),
  startedAt,
  finishedAt,
  networkProbe,
  localHostExposure,
};
await writeFile("/vercel/sandbox/managed-sandbox-proof.json", JSON.stringify(proof, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
const passed = networkProbe.blocked === true &&
  localHostExposure.repositoryGitPresent === false &&
  localHostExposure.repositoryAgentRulesPresent === false &&
  localHostExposure.repositoryPackagePresent === false &&
  localHostExposure.localEnvironmentFilePresent === false &&
  localHostExposure.windowsDriveMountPresent === false &&
  credentialLikeEnvironmentNames.length === 0;
console.log(JSON.stringify({ event: "MANAGED_SANDBOX_SMOKE_FINISHED", passed, platform: process.platform, hostname: os.hostname() }));
if (!passed) process.exitCode = 2;
`;

export const managedSandboxTimeoutProgram = String.raw`
import process from "node:process";
console.log(JSON.stringify({ event: "MANAGED_SANDBOX_TIMEOUT_PROBE_STARTED", pid: process.pid }));
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
`;
