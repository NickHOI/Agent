import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@donelayer/shared",
    "@donelayer/task-state-machine",
    "@donelayer/matching",
    "@donelayer/proof-of-done",
    "@donelayer/database",
    "@donelayer/worker-protocol",
    "@donelayer/agent-adapters"
  ],
  serverExternalPackages: ["node:sqlite"]
};

export default nextConfig;
