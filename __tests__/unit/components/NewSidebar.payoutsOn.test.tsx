import { render, screen } from '@testing-library/react';

/* The other half of NewSidebar.test.tsx: the sidebar with payouts switched ON
   (lib/payouts/switch.ts). Payouts are off in production, so nothing would
   notice if the Payments section stopped rendering, or lost its nav rules,
   until the day someone flips the switch back. This keeps that path honest. */
jest.mock('@/lib/payouts/switch', () => ({ PAYOUTS_ENABLED: true }));

jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: jest.fn() }),
}));
jest.mock('@/components/layout/NotificationBell', () => ({
  NotificationBell: () => <button aria-label="Notifications" />,
}));
jest.mock('@/components/feedback/FeedbackButton', () => ({
  FeedbackButton: () => <button aria-label="Send feedback about this page" />,
}));

import NewSidebar, { NAV_SECTIONS } from '@/components/NewSidebar';
import { DASHBOARD_NAV_RULES, resolveDashboardPolicy } from '@/lib/dashboardPolicy';

const PAYOUT_LINKS: Array<[string, string]> = [
  ['Payouts', '/payouts'],
  ['Requests', '/requests'],
  ['Recipients', '/recipients'],
];

describe('NewSidebar with payouts switched on', () => {
  it.each(PAYOUT_LINKS)('links %s to %s', (label, href) => {
    render(<NewSidebar />);
    expect(screen.getByRole('link', { name: new RegExp(`^${label}$`, 'i') })).toHaveAttribute('href', href);
  });

  it('gives every payout link a nav rule, so the allowlist does not drop it', () => {
    const ruleHrefs = new Set(DASHBOARD_NAV_RULES.map((r) => r.href));
    const navHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    for (const [, href] of PAYOUT_LINKS) {
      expect(navHrefs).toContain(href);
      expect(ruleHrefs.has(href)).toBe(true);
    }
  });

  it('keeps them for an org with no nav restriction', () => {
    const { allowedNavHrefs } = resolveDashboardPolicy({ entitlements: null, uiConfig: null });
    for (const [, href] of PAYOUT_LINKS) expect(allowedNavHrefs).toContain(href);
  });
});
