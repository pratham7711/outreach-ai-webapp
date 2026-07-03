import { createHmac, timingSafeEqual } from "crypto";
import {
  assertApprovalRef,
  assertValidAmountMinor,
  assertValidCurrency,
  type CreatePaymentIntentInput,
  type GatewayProvider,
  type PaymentIntent,
  type PaymentStatus,
  type PayoutInstruction,
  type PayoutResult,
  type ProviderCapabilities,
  type WebhookEvent,
  type WebhookHeaders,
} from "../types";

const MOCK_CAPABILITIES: ProviderCapabilities = {
  supportsPaymentIntents: true,
  supportsPayouts: true,
  supportsWebhooks: true,
  supportsRefunds: true,
};

function mockSecret(): string {
  return process.env.MOCK_WEBHOOK_SECRET || "mock-secret";
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function statusForAmount(amountMinor: number): PaymentStatus {
  const lastTwo = amountMinor % 100;
  if (lastTwo === 13) return "FAILED";
  if (lastTwo === 42) return "PENDING";
  return "SUCCEEDED";
}

export class MockGatewayProvider implements GatewayProvider {
  readonly name = "mock" as const;
  readonly capabilities = MOCK_CAPABILITIES;

  private intents = new Map<string, PaymentIntent>();

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    assertValidAmountMinor(input.amountMinor);
    assertValidCurrency(input.currency);

    const id = `mock_pi_${input.amountMinor}_${this.intents.size + 1}`;
    const status = statusForAmount(input.amountMinor);
    const intent: PaymentIntent = {
      id,
      provider: "mock",
      amountMinor: input.amountMinor,
      currency: input.currency,
      status,
      providerRef: id,
      metadata: input.metadata ?? {},
    };
    this.intents.set(id, intent);
    return intent;
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatus> {
    const existing = this.intents.get(providerRef);
    if (existing) return existing.status;
    const match = /^mock_pi_(\d+)_/.exec(providerRef);
    if (match) return statusForAmount(Number(match[1]));
    return "FAILED";
  }

  async createPayout(instruction: PayoutInstruction): Promise<PayoutResult> {
    assertApprovalRef(instruction.approvalRef);
    assertValidAmountMinor(instruction.amountMinor);
    assertValidCurrency(instruction.currency);

    const id = `mock_po_${instruction.amountMinor}_${Date.now()}`;
    return {
      id,
      provider: "mock",
      amountMinor: instruction.amountMinor,
      currency: instruction.currency,
      status: statusForAmount(instruction.amountMinor),
      providerRef: id,
      approvalRef: instruction.approvalRef,
    };
  }

  sign(rawBody: string): string {
    return createHmac("sha256", mockSecret()).update(rawBody, "utf8").digest("hex");
  }

  async verifyWebhookSignature(
    rawBody: string,
    headers: WebhookHeaders,
  ): Promise<WebhookEvent | null> {
    const provided = headerValue(headers, "x-mock-signature");
    if (!provided) return null;

    const expected = this.sign(rawBody);
    const providedBuf = Buffer.from(provided, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureValid =
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf);
    if (!signatureValid) return null;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }

    const eventId = typeof payload.id === "string" ? payload.id : "";
    const type = typeof payload.type === "string" ? payload.type : "unknown";
    if (!eventId) return null;

    return { provider: "mock", eventId, type, signatureValid: true, payload };
  }
}
