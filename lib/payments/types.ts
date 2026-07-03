export type PaymentProviderName = "mock" | "razorpay" | "stripe";

export type PaymentStatus =
  | "CREATED"
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REFUNDED";

export interface PaymentIntent {
  id: string;
  provider: PaymentProviderName;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  providerRef: string;
  metadata: Record<string, string>;
}

export interface CreatePaymentIntentInput {
  amountMinor: number;
  currency: string;
  metadata?: Record<string, string>;
}

export interface PayoutInstruction {
  amountMinor: number;
  currency: string;
  approvalRef: string;
  recipientRef: string;
  metadata?: Record<string, string>;
}

export interface PayoutResult {
  id: string;
  provider: PaymentProviderName;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  providerRef: string;
  approvalRef: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface WebhookEvent {
  provider: PaymentProviderName;
  eventId: string;
  type: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

export interface ProviderCapabilities {
  supportsPaymentIntents: boolean;
  supportsPayouts: boolean;
  supportsWebhooks: boolean;
  supportsRefunds: boolean;
}

export interface GatewayProvider {
  readonly name: PaymentProviderName;
  readonly capabilities: ProviderCapabilities;

  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent>;
  getPaymentStatus(providerRef: string): Promise<PaymentStatus>;
  createPayout(instruction: PayoutInstruction): Promise<PayoutResult>;
  verifyWebhookSignature(
    rawBody: string,
    headers: WebhookHeaders,
  ): Promise<WebhookEvent | null>;
}

export function assertValidAmountMinor(amountMinor: number): void {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) {
    throw new Error("amountMinor must be a finite number");
  }
  if (!Number.isInteger(amountMinor)) {
    throw new Error("amountMinor must be an integer in minor units");
  }
  if (amountMinor <= 0) {
    throw new Error("amountMinor must be a positive integer in minor units");
  }
}

export function assertValidCurrency(currency: unknown): asserts currency is string {
  if (typeof currency !== "string" || currency.trim().length === 0) {
    throw new Error("currency is required");
  }
}

export function assertApprovalRef(approvalRef: unknown): asserts approvalRef is string {
  if (typeof approvalRef !== "string" || approvalRef.trim().length === 0) {
    throw new Error("createPayout requires a non-empty approvalRef");
  }
}
