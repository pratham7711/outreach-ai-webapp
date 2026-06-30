export type RecipientPayout = {
  creatorId: string;
  creatorName: string;
  creatorHandle: string | null;
  creatorPlatform: string | null;
  amount: number;
  status: string;
  paymentMethod: string;
  recipientPaypalEmail: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type Recipient = {
  creatorId: string;
  name: string;
  handle: string | null;
  platform: string | null;
  paymentMethods: string[];
  paypalEmail: string | null;
  totalPaid: number;
  pending: number;
  failed: number;
  payoutCount: number;
  lastPayoutAt: string | null;
};

export type RecipientStats = {
  recipientCount: number;
  totalPaid: number;
  totalPending: number;
  totalFailed: number;
};

const PAID_STATUSES = new Set(["SUCCESS"]);
const PENDING_STATUSES = new Set(["PENDING", "PROCESSING"]);
const FAILED_STATUSES = new Set(["FAILED"]);

function safeAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

type Accumulator = {
  creatorId: string;
  name: string;
  handle: string | null;
  platform: string | null;
  methods: Set<string>;
  paypalEmail: string | null;
  paypalEmailAt: string | null;
  totalPaid: number;
  pending: number;
  failed: number;
  payoutCount: number;
  lastPayoutAt: string | null;
};

export function buildRecipients(payouts: RecipientPayout[]): Recipient[] {
  if (!Array.isArray(payouts)) return [];
  const byCreator = new Map<string, Accumulator>();

  for (const p of payouts) {
    if (!p || typeof p.creatorId !== "string" || p.creatorId.length === 0) continue;
    let acc = byCreator.get(p.creatorId);
    if (!acc) {
      acc = {
        creatorId: p.creatorId,
        name: p.creatorName || "Unknown recipient",
        handle: p.creatorHandle ?? null,
        platform: p.creatorPlatform ?? null,
        methods: new Set<string>(),
        paypalEmail: null,
        paypalEmailAt: null,
        totalPaid: 0,
        pending: 0,
        failed: 0,
        payoutCount: 0,
        lastPayoutAt: null,
      };
      byCreator.set(p.creatorId, acc);
    }

    acc.payoutCount += 1;
    const amount = safeAmount(p.amount);
    const status = typeof p.status === "string" ? p.status.toUpperCase() : "";
    if (PAID_STATUSES.has(status)) acc.totalPaid += amount;
    else if (PENDING_STATUSES.has(status)) acc.pending += amount;
    else if (FAILED_STATUSES.has(status)) acc.failed += amount;

    if (typeof p.paymentMethod === "string" && p.paymentMethod.length > 0) {
      acc.methods.add(p.paymentMethod);
    }

    const createdAt = typeof p.createdAt === "string" ? p.createdAt : null;
    if (p.recipientPaypalEmail && createdAt) {
      const isNewer = !acc.paypalEmailAt || createdAt > acc.paypalEmailAt;
      const isTie =
        acc.paypalEmailAt === createdAt && (acc.paypalEmail === null || p.recipientPaypalEmail < acc.paypalEmail);
      if (isNewer || isTie) {
        acc.paypalEmail = p.recipientPaypalEmail;
        acc.paypalEmailAt = createdAt;
      }
    }

    const eventAt = p.completedAt ?? createdAt;
    acc.lastPayoutAt = laterIso(acc.lastPayoutAt, eventAt);
  }

  const recipients: Recipient[] = [];
  for (const acc of byCreator.values()) {
    recipients.push({
      creatorId: acc.creatorId,
      name: acc.name,
      handle: acc.handle,
      platform: acc.platform,
      paymentMethods: Array.from(acc.methods).sort(),
      paypalEmail: acc.paypalEmail,
      totalPaid: acc.totalPaid,
      pending: acc.pending,
      failed: acc.failed,
      payoutCount: acc.payoutCount,
      lastPayoutAt: acc.lastPayoutAt,
    });
  }

  recipients.sort((a, b) => {
    if (b.totalPaid !== a.totalPaid) return b.totalPaid - a.totalPaid;
    if (b.payoutCount !== a.payoutCount) return b.payoutCount - a.payoutCount;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.creatorId.localeCompare(b.creatorId);
  });

  return recipients;
}

export function summarizeRecipients(recipients: Recipient[]): RecipientStats {
  if (!Array.isArray(recipients)) {
    return { recipientCount: 0, totalPaid: 0, totalPending: 0, totalFailed: 0 };
  }
  let totalPaid = 0;
  let totalPending = 0;
  let totalFailed = 0;
  for (const r of recipients) {
    totalPaid += safeAmount(r.totalPaid);
    totalPending += safeAmount(r.pending);
    totalFailed += safeAmount(r.failed);
  }
  return { recipientCount: recipients.length, totalPaid, totalPending, totalFailed };
}
