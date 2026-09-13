import assert from "node:assert/strict";
import test from "node:test";

import { retry } from "../src/retry.ts";

test("zero retries still performs the initial attempt", async () => {
  const attempts: number[] = [];
  const value = await retry(async (attempt) => {
    attempts.push(attempt);
    return "ready";
  }, 0);

  assert.equal(value, "ready");
  assert.deepEqual(attempts, [0]);
});

test("two retries permit three total attempts", async () => {
  const attempts: number[] = [];
  const value = await retry(async (attempt) => {
    attempts.push(attempt);
    if (attempt < 2) throw new Error(`temporary-${attempt}`);
    return "recovered";
  }, 2);

  assert.equal(value, "recovered");
  assert.deepEqual(attempts, [0, 1, 2]);
});

test("the exact final error is rethrown after exhaustion", async () => {
  const finalError = new Error("terminal");
  let calls = 0;
  await assert.rejects(
    retry(async () => {
      calls += 1;
      throw finalError;
    }, 1),
    (error) => error === finalError,
  );
  assert.equal(calls, 2);
});

test("execution stops immediately after the first success", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary");
    return 42;
  }, 3);

  assert.equal(value, 42);
  assert.equal(calls, 2);
});

test("invalid retry counts fail before invoking the operation", async () => {
  let calls = 0;
  const operation = async () => { calls += 1; };
  await assert.rejects(retry(operation, -1), RangeError);
  await assert.rejects(retry(operation, 1.5), RangeError);
  await assert.rejects(retry(operation, 4), RangeError);
  assert.equal(calls, 0);
});
