import assert from "node:assert/strict";
import test from "node:test";

import { buildLabel } from "../src/shared/version.ts";

test("the shared build label normalizes surrounding whitespace", () => {
  assert.equal(buildLabel(" 2026.09 "), "build:2026.09");
});
