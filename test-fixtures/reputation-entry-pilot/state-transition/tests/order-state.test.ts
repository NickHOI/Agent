import assert from "node:assert/strict";
import test from "node:test";

import { transitionOrder } from "../src/order-state.ts";

test("captured payment moves a pending order to paid", () => {
  assert.equal(transitionOrder("PAYMENT_PENDING", "CAPTURE_PAYMENT"), "PAID");
});

test("only a paid order can be fulfilled", () => {
  assert.equal(transitionOrder("PAID", "FULFILL"), "FULFILLED");
  assert.throws(() => transitionOrder("PAYMENT_PENDING", "FULFILL"), /INVALID_ORDER_TRANSITION/);
});

test("a pending order can be cancelled but terminal states stay terminal", () => {
  assert.equal(transitionOrder("PAYMENT_PENDING", "CANCEL"), "CANCELLED");
  assert.throws(() => transitionOrder("CANCELLED", "CAPTURE_PAYMENT"), /INVALID_ORDER_TRANSITION/);
  assert.throws(() => transitionOrder("FULFILLED", "CANCEL"), /INVALID_ORDER_TRANSITION/);
});
