import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeConfig } from "../src/runtime-config.ts";

test("production enables audit events", () => {
  assert.deepEqual(createRuntimeConfig("production"), {
    environment: "production",
    auditEventsEnabled: true,
  });
});

test("development keeps audit events disabled", () => {
  assert.deepEqual(createRuntimeConfig("development"), {
    environment: "development",
    auditEventsEnabled: false,
  });
});
