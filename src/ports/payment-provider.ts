import type { IBookingPayment } from "../models/payments/BookingPayment.js";
import { ApiError } from "../utils/ApiError.js";

export type WebhookHeaders = Readonly<Record<string, string>>;

export interface VerifiedPaymentTransaction {
  providerTransactionId: string;
  merchantAccountId?: string;
  amountMinor: number;
  currency: string;
  purpose: "advance" | "advance_refund";
  status: "succeeded";
  paymentMethodType?: IBookingPayment["paymentMethodType"];
  processedAt: Date;
}

export interface VerifiedPaymentWebhook {
  providerEventId: string;
  merchantAccountId: string;
  eventType: string;
}

export interface AdvanceCheckoutResult {
  providerCheckoutId: string;
  expiresAt: Date;
  checkoutUrl?: string;
  clientToken?: string;
}

export interface PaymentProviderAdapter {
  readonly provider: string;
  readonly webhookHeaderNames: readonly string[];
  createAdvanceCheckout(input: {
    idempotencyKey: string;
    bookingId: string;
    bookingReference: string;
    customer: {
      id: string;
      name: string;
      email?: string;
      phone?: string;
    };
    amountMinor: number;
    currency: string;
    holdExpiresAt?: Date;
  }): Promise<AdvanceCheckoutResult>;
  verifyTransaction(input: {
    providerTransactionId: string;
    merchantAccountId?: string;
    expectedBookingId: string;
    expectedAmountMinor?: number;
    expectedCurrency?: string;
    expectedPurpose: "advance" | "advance_refund";
  }): Promise<VerifiedPaymentTransaction>;
  /**
   * Implementations must validate the provider signature against `rawBody`
   * before returning parsed identifiers. Throw when the signature is absent,
   * stale, malformed, or invalid.
   */
  verifyWebhookSignatureAndParse(input: {
    rawBody: Buffer;
    headers: WebhookHeaders;
  }): Promise<VerifiedPaymentWebhook>;
  processVerifiedWebhook(input: {
    event: VerifiedPaymentWebhook;
    rawBody: Buffer;
    headers: WebhookHeaders;
  }): Promise<"processed" | "ignored">;
}

const adapters = new Map<string, PaymentProviderAdapter>();
const normalizeProvider = (provider: string): string =>
  provider.trim().toLowerCase();

export const registerPaymentProvider = (
  adapter: PaymentProviderAdapter,
): void => {
  const provider = normalizeProvider(adapter.provider);
  if (!provider || provider === "manual") {
    throw new Error("A payment adapter must have a non-manual provider name");
  }
  if (adapters.has(provider)) {
    throw new Error(`Payment provider '${provider}' is already registered`);
  }
  adapters.set(provider, adapter);
};

export const getPaymentProvider = (
  provider: string,
): PaymentProviderAdapter => {
  const normalized = normalizeProvider(provider);
  const adapter = adapters.get(normalized);
  if (!adapter) {
    throw new ApiError(503, "Payment provider is not configured", {
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      details: { provider: normalized },
      expose: true,
    });
  }
  return adapter;
};

export const hasPaymentProvider = (provider: string): boolean =>
  adapters.has(normalizeProvider(provider));

export const listConfiguredPaymentProviders = (): string[] =>
  [...adapters.keys()].sort();
