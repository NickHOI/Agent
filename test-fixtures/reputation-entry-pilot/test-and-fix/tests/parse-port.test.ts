import assert from "node:assert/strict";
import test from "node:test";

import { parsePort } from "../src/parse-port.ts";

test("parses valid decimal port strings", () => {
  assert.equal(parsePort("3000"), 3000);
  assert.equal(parsePort(" 443 "), 443);
  assert.equal(parsePort("65535"), 65535);
});

test("rejects partial, fractional, empty, and out-of-range input", () => {
  for (const input of ["443abc", "12.5", "", "0", "-1", "65536"]) {
    assert.throws(() => parsePort(input), RangeError, input);
  }
});
