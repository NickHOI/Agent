export interface PaymentBalance {
  ownerId: string;
  availableCents: number;
  reservedCents: number;
  pendingCents: number;
  heldCents: number;
}

export interface ReservePaymentInput {
  taskId: string;
  customerId: string;
  amountCents: number;
}

export interface ReleasePaymentInput {
  taskId: string;
  providerId: string;
}

export interface PaymentDistribution {
  grossCents: number;
  providerCents: number;
  platformFeeCents: number;
}

export interface PaymentProvider {
  reserve(input: ReservePaymentInput): Promise<PaymentBalance>;
  release(input: ReleasePaymentInput): Promise<PaymentDistribution>;
  refund(taskId: string): Promise<PaymentBalance>;
  holdForDispute(taskId: string): Promise<PaymentBalance>;
  getBalance(ownerId: string): Promise<PaymentBalance>;
}

type ReservationStatus = "RESERVED" | "RELEASED" | "REFUNDED" | "DISPUTED";

interface Reservation {
  taskId: string;
  customerId: string;
  amountCents: number;
  status: ReservationStatus;
}

const PLATFORM_OWNER_ID = "platform";

function assertCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Payment amounts must be positive integer cents.");
  }
}

export class TestLedgerProvider implements PaymentProvider {
  private readonly balances = new Map<string, PaymentBalance>();
  private readonly reservations = new Map<string, Reservation>();

  constructor(
    initialBalances: Record<string, number> = {},
    private readonly platformFeeBasisPoints = 2_000,
  ) {
    if (!Number.isInteger(platformFeeBasisPoints) || platformFeeBasisPoints < 0 || platformFeeBasisPoints > 10_000) {
      throw new Error("Platform fee must be between 0 and 10,000 basis points.");
    }

    for (const [ownerId, availableCents] of Object.entries(initialBalances)) {
      if (!Number.isSafeInteger(availableCents) || availableCents < 0) {
        throw new Error(`Invalid initial balance for ${ownerId}.`);
      }
      this.balances.set(ownerId, {
        ownerId,
        availableCents,
        reservedCents: 0,
        pendingCents: 0,
        heldCents: 0,
      });
    }
  }

  private wallet(ownerId: string): PaymentBalance {
    const existing = this.balances.get(ownerId);
    if (existing) return existing;

    const created: PaymentBalance = {
      ownerId,
      availableCents: 0,
      reservedCents: 0,
      pendingCents: 0,
      heldCents: 0,
    };
    this.balances.set(ownerId, created);
    return created;
  }

  private reservation(taskId: string): Reservation {
    const reservation = this.reservations.get(taskId);
    if (!reservation) throw new Error(`Task ${taskId} has no reserved payment.`);
    return reservation;
  }

  async reserve(input: ReservePaymentInput): Promise<PaymentBalance> {
    assertCents(input.amountCents);
    const existing = this.reservations.get(input.taskId);
    if (existing) {
      if (existing.customerId !== input.customerId || existing.amountCents !== input.amountCents) {
        throw new Error(`Task ${input.taskId} already has a different reservation.`);
      }
      return this.getBalance(input.customerId);
    }

    const customer = this.wallet(input.customerId);
    if (customer.availableCents < input.amountCents) {
      throw new Error("Insufficient test balance.");
    }

    customer.availableCents -= input.amountCents;
    customer.reservedCents += input.amountCents;
    this.reservations.set(input.taskId, { ...input, status: "RESERVED" });
    return structuredClone(customer);
  }

  async release(input: ReleasePaymentInput): Promise<PaymentDistribution> {
    const reservation = this.reservation(input.taskId);
    if (reservation.status === "RELEASED") {
      const platformFeeCents = Math.floor((reservation.amountCents * this.platformFeeBasisPoints) / 10_000);
      return {
        grossCents: reservation.amountCents,
        providerCents: reservation.amountCents - platformFeeCents,
        platformFeeCents,
      };
    }
    if (reservation.status !== "RESERVED") {
      throw new Error(`Cannot release a ${reservation.status.toLocaleLowerCase("en-US")} reservation.`);
    }

    const customer = this.wallet(reservation.customerId);
    if (customer.reservedCents < reservation.amountCents) {
      throw new Error("Ledger invariant failed: reserved balance is missing.");
    }

    const platformFeeCents = Math.floor((reservation.amountCents * this.platformFeeBasisPoints) / 10_000);
    const providerCents = reservation.amountCents - platformFeeCents;
    customer.reservedCents -= reservation.amountCents;
    this.wallet(input.providerId).availableCents += providerCents;
    this.wallet(PLATFORM_OWNER_ID).availableCents += platformFeeCents;
    reservation.status = "RELEASED";

    return { grossCents: reservation.amountCents, providerCents, platformFeeCents };
  }

  async refund(taskId: string): Promise<PaymentBalance> {
    const reservation = this.reservation(taskId);
    if (reservation.status === "REFUNDED") return this.getBalance(reservation.customerId);
    if (reservation.status !== "RESERVED") {
      throw new Error(`Cannot refund a ${reservation.status.toLocaleLowerCase("en-US")} reservation.`);
    }

    const customer = this.wallet(reservation.customerId);
    if (customer.reservedCents < reservation.amountCents) {
      throw new Error("Ledger invariant failed: reserved balance is missing.");
    }
    customer.reservedCents -= reservation.amountCents;
    customer.availableCents += reservation.amountCents;
    reservation.status = "REFUNDED";
    return structuredClone(customer);
  }

  async holdForDispute(taskId: string): Promise<PaymentBalance> {
    const reservation = this.reservation(taskId);
    if (reservation.status === "DISPUTED") return this.getBalance(reservation.customerId);
    if (reservation.status !== "RESERVED") {
      throw new Error(`Cannot dispute a ${reservation.status.toLocaleLowerCase("en-US")} reservation.`);
    }

    const customer = this.wallet(reservation.customerId);
    if (customer.reservedCents < reservation.amountCents) {
      throw new Error("Ledger invariant failed: reserved balance is missing.");
    }
    customer.reservedCents -= reservation.amountCents;
    customer.heldCents += reservation.amountCents;
    reservation.status = "DISPUTED";
    return structuredClone(customer);
  }

  async getBalance(ownerId: string): Promise<PaymentBalance> {
    return structuredClone(this.wallet(ownerId));
  }
}

export class StripeConnectProvider implements PaymentProvider {
  private unavailable(): never {
    if (process.env.ENABLE_STRIPE_TEST_MODE !== "true") {
      throw new Error("Stripe Connect is disabled. Enable the test-mode feature flag before configuring this adapter.");
    }
    throw new Error("Stripe Connect is a deliberate MVP skeleton; TestLedgerProvider remains authoritative.");
  }

  reserve(_input: ReservePaymentInput): Promise<PaymentBalance> {
    return this.unavailable();
  }

  release(_input: ReleasePaymentInput): Promise<PaymentDistribution> {
    return this.unavailable();
  }

  refund(_taskId: string): Promise<PaymentBalance> {
    return this.unavailable();
  }

  holdForDispute(_taskId: string): Promise<PaymentBalance> {
    return this.unavailable();
  }

  getBalance(_ownerId: string): Promise<PaymentBalance> {
    return this.unavailable();
  }
}
