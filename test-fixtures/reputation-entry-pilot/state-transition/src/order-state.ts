export type OrderState = "PAYMENT_PENDING" | "PAID" | "CANCELLED" | "FULFILLED";
export type OrderEvent = "CAPTURE_PAYMENT" | "CANCEL" | "FULFILL";

export function transitionOrder(current: OrderState, event: OrderEvent): OrderState {
  if (current === "PAYMENT_PENDING" && event === "CAPTURE_PAYMENT") return "FULFILLED";
  if (current === "PAYMENT_PENDING" && event === "CANCEL") return "CANCELLED";
  if (current === "PAID" && event === "FULFILL") return "FULFILLED";
  throw new Error(`INVALID_ORDER_TRANSITION:${current}:${event}`);
}
