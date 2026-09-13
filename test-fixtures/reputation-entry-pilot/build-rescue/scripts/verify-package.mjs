import assert from "node:assert/strict";

import { normalizeSlug } from "../src/index.ts";

assert.equal(normalizeSlug("  Release Candidate  "), "release-candidate");
console.log("package export surface verified");
