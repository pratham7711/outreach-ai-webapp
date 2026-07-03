import type { GatewayProvider, PaymentProviderName } from "./types";
import { MockGatewayProvider } from "./providers/mock";
import { RazorpayGatewayProvider, razorpayConfigFromEnv } from "./providers/razorpay";
import { StripeGatewayProvider, stripeConfigFromEnv } from "./providers/stripe";

function normalize(name?: string): string | undefined {
  return name?.trim().toLowerCase() || undefined;
}

export function isProviderConfigured(name: string): boolean {
  switch (normalize(name)) {
    case "mock":
      return true;
    case "razorpay":
      return razorpayConfigFromEnv() !== null;
    case "stripe":
      return stripeConfigFromEnv() !== null;
    default:
      return false;
  }
}

export function getGateway(provider?: string): GatewayProvider {
  const requested = normalize(provider) ?? normalize(process.env.PAYMENT_PROVIDER);

  switch (requested) {
    case "razorpay":
      return new RazorpayGatewayProvider();
    case "stripe":
      return new StripeGatewayProvider();
    case "mock":
      return new MockGatewayProvider();
    case undefined:
      return new MockGatewayProvider();
    default:
      throw new Error(`Unknown payment provider: ${requested}`);
  }
}

export function resolveProviderName(provider?: string): PaymentProviderName {
  const requested = normalize(provider) ?? normalize(process.env.PAYMENT_PROVIDER);
  if (requested === "razorpay" || requested === "stripe" || requested === "mock") {
    return requested;
  }
  return "mock";
}
