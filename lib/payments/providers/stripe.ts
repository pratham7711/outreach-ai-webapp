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

const API_BASE = "https://api.stripe.com/v1";
const TIMEOUT_MS = 8000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

const CAPABILITIES: ProviderCapabilities = {
  supportsPaymentIntents: true,
  supportsPayouts: true,
  supportsWebhooks: true,
  supportsRefunds: true,
};

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

function mapIntentStatus(status: string): PaymentStatus {
  switch (status) {
    case "requires_payment_method":
    case "requires_confirmation":
    case "requires_action":
      return "CREATED";
    case "processing":
    case "requires_capture":
      return "PENDING";
    case "succeeded":
      return "SUCCEEDED";
    case "canceled":
      return "FAILED";
    default:
      return "PENDING";
  }
}

function encodeForm(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.append(key, String(value));
  }
  return search.toString();
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret?: string;
}

export function stripeConfigFromEnv(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return { secretKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };
}

export class StripeGatewayProvider implements GatewayProvider {
  readonly name = "stripe" as const;
  readonly capabilities = CAPABILITIES;

  private config: StripeConfig;

  constructor(config?: StripeConfig) {
    const resolved = config ?? stripeConfigFromEnv();
    if (!resolved) {
      throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
    }
    this.config = resolved;
  }

  private async request(
    path: string,
    method: string,
    form?: Record<string, string | number | undefined>,
    idempotencyKey?: string,
  ): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

      const res = await fetch(`${API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers,
        body: form ? encodeForm(form) : undefined,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Stripe request failed with status ${res.status}`);
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    assertValidAmountMinor(input.amountMinor);
    assertValidCurrency(input.currency);

    const form: Record<string, string | number> = {
      amount: input.amountMinor,
      currency: input.currency.toLowerCase(),
    };
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      form[`metadata[${key}]`] = value;
    }

    const intent = await this.request("/payment_intents", "POST", form);

    return {
      id: intent.id,
      provider: "stripe",
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: mapIntentStatus(intent.status ?? "requires_payment_method"),
      providerRef: intent.id,
      metadata: input.metadata ?? {},
    };
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatus> {
    const intent = await this.request(
      `/payment_intents/${encodeURIComponent(providerRef)}`,
      "GET",
    );
    return mapIntentStatus(intent.status ?? "processing");
  }

  async createPayout(instruction: PayoutInstruction): Promise<PayoutResult> {
    assertApprovalRef(instruction.approvalRef);
    assertValidAmountMinor(instruction.amountMinor);
    assertValidCurrency(instruction.currency);

    const transfer = await this.request(
      "/transfers",
      "POST",
      {
        amount: instruction.amountMinor,
        currency: instruction.currency.toLowerCase(),
        destination: instruction.recipientRef,
        "metadata[approvalRef]": instruction.approvalRef,
      },
      instruction.approvalRef,
    );

    return {
      id: transfer.id,
      provider: "stripe",
      amountMinor: instruction.amountMinor,
      currency: instruction.currency,
      status: "PENDING",
      providerRef: transfer.id,
      approvalRef: instruction.approvalRef,
    };
  }

  async verifyWebhookSignature(
    rawBody: string,
    headers: WebhookHeaders,
  ): Promise<WebhookEvent | null> {
    const secret = this.config.webhookSecret;
    if (!secret) return null;

    const header = headerValue(headers, "stripe-signature");
    if (!header) return null;

    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const part of header.split(",")) {
      const [key, value] = part.split("=");
      if (key === "t") timestamp = value;
      else if (key === "v1" && value) signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return null;

    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds)) return null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
      return null;
    }

    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureValid = signatures.some((candidate) => {
      const candidateBuf = Buffer.from(candidate, "utf8");
      return (
        candidateBuf.length === expectedBuf.length &&
        timingSafeEqual(candidateBuf, expectedBuf)
      );
    });
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

    return { provider: "stripe", eventId, type, signatureValid: true, payload };
  }
}
