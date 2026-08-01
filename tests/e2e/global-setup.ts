import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import next from "next";

async function serverAlreadyRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
  const hostname = "127.0.0.1";
  const baseURL = `http://${hostname}:${port}`;

  if (await serverAlreadyRunning(baseURL)) return undefined;

  process.env.APP_MODE = "demo";
  process.env.NEXT_PUBLIC_APP_URL = baseURL;
  process.env.DEMO_DATABASE_PATH = `.data/playwright-donelayer-${process.pid}.sqlite`;
  process.env.DEMO_SESSION_SECRET = "playwright-only-demo-session-secret-32-chars";
  const requiredServerFiles = JSON.parse(
    await readFile(resolve("apps/web/.next/required-server-files.json"), "utf8"),
  ) as { config: Record<string, unknown> };
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredServerFiles.config);

  const app = next({
    dev: false,
    dir: resolve("apps/web"),
    hostname,
    port,
  });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = createServer((request, response) => handler(request, response));

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => resolveListening());
  });

  return async () => {
    await new Promise<void>((resolveClosed, reject) => {
      server.close((error) => (error ? reject(error) : resolveClosed()));
    });
    await app.close();
  };
}
