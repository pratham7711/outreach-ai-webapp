import { createHash, createHmac, timingSafeEqual } from "crypto";
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

const API_BASE = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 8000;

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

function mapOrderStatus(status: string): PaymentStatus {
  switch (status) {
    case "created":
      return "CREATED";
    case "attempted":
      return "PENDING";
    case "paid":
      return "SUCCEEDED";
    default:
      return "PENDING";
  }
}

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
}

export function razorpayConfigFromEnv(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  return {
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
}

export class RazorpayGatewayProvider implements GatewayProvider {
  readonly name = "razorpay" as const;
  readonly capabilities = CAPABILITIES;

  private config: RazorpayConfig;

  constructor(config?: RazorpayConfig) {
    const resolved = config ?? razorpayConfigFromEnv();
    if (!resolved) {
      throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
    }
    this.config = resolved;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString("base64");
    return `Basic ${token}`;
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: this.authHeader(),
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Razorpay request failed with status ${res.status}`);
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timer);
    }
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntent> {
    assertValidAmountMinor(input.amountMinor);
    assertValidCurrency(input.currency);

    const notes = input.metadata ?? {};
    const order = await this.request("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        notes,
      }),
    });

    return {
      id: order.id,
      provider: "razorpay",
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: mapOrderStatus(order.status ?? "created"),
      providerRef: order.id,
      metadata: notes,
    };
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatus> {
    const order = await this.request(`/orders/${encodeURIComponent(providerRef)}`, {
      method: "GET",
    });
    return mapOrderStatus(order.status ?? "created");
  }

  async createPayout(instruction: PayoutInstruction): Promise<PayoutResult> {
    assertApprovalRef(instruction.approvalRef);
    assertValidAmountMinor(instruction.amountMinor);
    assertValidCurrency(instruction.currency);

    const payout = await this.request("/payouts", {
      method: "POST",
      body: JSON.stringify({
        amount: instruction.amountMinor,
        currency: instruction.currency,
        fund_account_id: instruction.recipientRef,
        reference_id: instruction.approvalRef,
        notes: instruction.metadata ?? {},
      }),
    });

    return {
      id: payout.id,
      provider: "razorpay",
      amountMinor: instruction.amountMinor,
      currency: instruction.currency,
      status: payout.status === "processed" ? "SUCCEEDED" : "PENDING",
      providerRef: payout.id,
      approvalRef: instruction.approvalRef,
    };
  }

  async verifyWebhookSignature(
    rawBody: string,
    headers: WebhookHeaders,
  ): Promise<WebhookEvent | null> {
    const secret = this.config.webhookSecret;
    if (!secret) return null;

    const provided = headerValue(headers, "x-razorpay-signature");
    if (!provided) return null;

    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
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

    const eventId =
      headerValue(headers, "x-razorpay-event-id") ??
      `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
    const type = typeof payload.event === "string" ? payload.event : "unknown";

    return { provider: "razorpay", eventId, type, signatureValid: true, payload };
  }
}
