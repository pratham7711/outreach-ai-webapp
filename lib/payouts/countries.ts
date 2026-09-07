/**
 * The country registry behind creator payout destinations.
 *
 * A creator's country of residence decides three things at once: which currency
 * they are paid in, which bank identifier their account must carry (an Indian
 * account has an IFSC and never a routing number), and which payout methods are
 * reachable at all. Keeping that in one table means adding a country is a data
 * change rather than a code change.
 *
 * `bankIdentifiers` is ordered: the first entry is what the form asks for.
 */

export type BankIdentifier = "IFSC" | "ROUTING" | "IBAN" | "SORT_CODE" | "BSB" | "SWIFT";

export interface PayoutCountry {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** ISO 4217. Not the Currency enum — that only has four members. */
  currency: string;
  /** Required identifiers for a bank destination, most specific first. */
  bankIdentifiers: BankIdentifier[];
  /** Whether UPI is a real rail here. Only India, today. */
  supportsUpi: boolean;
}

export const PAYOUT_COUNTRIES: PayoutCountry[] = [
  { code: "IN", name: "India", currency: "INR", bankIdentifiers: ["IFSC"], supportsUpi: true },
  { code: "US", name: "United States", currency: "USD", bankIdentifiers: ["ROUTING"], supportsUpi: false },
  { code: "GB", name: "United Kingdom", currency: "GBP", bankIdentifiers: ["SORT_CODE"], supportsUpi: false },
  { code: "CA", name: "Canada", currency: "CAD", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "AU", name: "Australia", currency: "AUD", bankIdentifiers: ["BSB"], supportsUpi: false },
  { code: "NZ", name: "New Zealand", currency: "NZD", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "BR", name: "Brazil", currency: "BRL", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "MX", name: "Mexico", currency: "MXN", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "AR", name: "Argentina", currency: "ARS", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "DE", name: "Germany", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "FR", name: "France", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "ES", name: "Spain", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "IT", name: "Italy", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "NL", name: "Netherlands", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "IE", name: "Ireland", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "PT", name: "Portugal", currency: "EUR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "PL", name: "Poland", currency: "PLN", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "SE", name: "Sweden", currency: "SEK", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "NO", name: "Norway", currency: "NOK", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "DK", name: "Denmark", currency: "DKK", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "CH", name: "Switzerland", currency: "CHF", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "AE", name: "United Arab Emirates", currency: "AED", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "SA", name: "Saudi Arabia", currency: "SAR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "SG", name: "Singapore", currency: "SGD", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "MY", name: "Malaysia", currency: "MYR", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "ID", name: "Indonesia", currency: "IDR", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "PH", name: "Philippines", currency: "PHP", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "TH", name: "Thailand", currency: "THB", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "VN", name: "Vietnam", currency: "VND", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "JP", name: "Japan", currency: "JPY", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "KR", name: "South Korea", currency: "KRW", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "PK", name: "Pakistan", currency: "PKR", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "BD", name: "Bangladesh", currency: "BDT", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "LK", name: "Sri Lanka", currency: "LKR", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "NP", name: "Nepal", currency: "NPR", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "NG", name: "Nigeria", currency: "NGN", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "KE", name: "Kenya", currency: "KES", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "GH", name: "Ghana", currency: "GHS", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "ZA", name: "South Africa", currency: "ZAR", bankIdentifiers: ["SWIFT"], supportsUpi: false },
  { code: "EG", name: "Egypt", currency: "EGP", bankIdentifiers: ["IBAN"], supportsUpi: false },
  { code: "TR", name: "Türkiye", currency: "TRY", bankIdentifiers: ["IBAN"], supportsUpi: false },
];

const BY_CODE = new Map(PAYOUT_COUNTRIES.map((c) => [c.code, c]));

export function findCountry(code: string | null | undefined): PayoutCountry | null {
  if (!code) return null;
  return BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

export function isSupportedCountry(code: string | null | undefined): boolean {
  return findCountry(code) !== null;
}
