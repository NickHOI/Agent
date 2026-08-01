import { describe, expect, it } from "vitest";

import { TestLedgerProvider } from "@donelayer/database";

describe("TestLedgerProvider", () => {
  it("reserves and releases an 80/20 simulated payment idempotently", async () => {
    const ledger = new TestLedgerProvider({ customer: 100_000 });

    await ledger.reserve({ taskId: "task-1", customerId: "customer", amountCents: 25_000 });
    const distribution = await ledger.release({ taskId: "task-1", providerId: "provider" });
    const duplicate = await ledger.release({ taskId: "task-1", providerId: "provider" });

    expect(distribution).toEqual({ grossCents: 25_000, providerCents: 20_000, platformFeeCents: 5_000 });
    expect(duplicate).toEqual(distribution);
    await expect(ledger.getBalance("customer")).resolves.toMatchObject({ availableCents: 75_000, reservedCents: 0 });
    await expect(ledger.getBalance("provider")).resolves.toMatchObject({ availableCents: 20_000 });
    await expect(ledger.getBalance("platform")).resolves.toMatchObject({ availableCents: 5_000 });
  });

  it("refunds a reserved amount and can move it to dispute hold", async () => {
    const ledger = new TestLedgerProvider({ customer: 50_000 });
    await ledger.reserve({ taskId: "refund", customerId: "customer", amountCents: 10_000 });
    await ledger.refund("refund");
    await expect(ledger.getBalance("customer")).resolves.toMatchObject({ availableCents: 50_000, reservedCents: 0 });

    await ledger.reserve({ taskId: "dispute", customerId: "customer", amountCents: 12_000 });
    await ledger.holdForDispute("dispute");
    await expect(ledger.getBalance("customer")).resolves.toMatchObject({
      availableCents: 38_000,
      reservedCents: 0,
      heldCents: 12_000,
    });
  });
});
