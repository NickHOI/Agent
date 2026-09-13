import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSlug } from "../src/slug.ts";

test("normalizes a value through the internal module", () => {
  assert.equal(normalizeSlug("  Hello, World!  "), "hello-world");
});
