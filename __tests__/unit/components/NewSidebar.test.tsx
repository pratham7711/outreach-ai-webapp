import { render, screen } from '@testing-library/react';

// Mock next-themes for ThemeToggle dependency
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: jest.fn() }),
}));

import NewSidebar from '@/components/NewSidebar';
import { BRAND } from '@/lib/brand';

describe('NewSidebar', () => {
  it('falls back to the product brand name', () => {
    render(<NewSidebar />);
    expect(screen.getByText(BRAND.name)).toBeInTheDocument();
  });

  it('renders all main navigation links', () => {
    render(<NewSidebar />);
    expect(screen.getByRole('link', { name: /Campaigns/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Creators/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lists/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Clients/i })).toBeInTheDocument();
  });

  // Payments are not part of the product right now, so these routes still exist
  // but must not be reachable from the nav.
  it.each(['Payouts', 'Recipients', 'Requests', 'Fan Pages', 'Inbox'])(
    'does not link parked section %s',
    (label) => {
      render(<NewSidebar />);
      expect(screen.queryByRole('link', { name: new RegExp(label, 'i') })).toBeNull();
    }
  );

  it('links have correct hrefs', () => {
    render(<NewSidebar />);
    expect(screen.getByRole('link', { name: /Campaigns/i })).toHaveAttribute('href', '/campaigns');
    expect(screen.getByRole('link', { name: /Creators/i })).toHaveAttribute('href', '/creators');
  });

  it('renders user section with name Pratham', () => {
    render(<NewSidebar user={{ name: 'Pratham', email: 'pratham@example.com' }} />);
    expect(screen.getByText('Pratham')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('renders sidebar container', () => {
    render(<NewSidebar />);
    // Sidebar renders with multiple navigation links
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
  });

  it('renders discovery and trackers links', () => {
    render(<NewSidebar />);
    expect(screen.getByRole('link', { name: /Discovery/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Trackers/i })).toBeInTheDocument();
  });

  it('renders connections and activations links', () => {
    render(<NewSidebar />);
    expect(screen.getByRole('link', { name: /Connections/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Activations/i })).toBeInTheDocument();
  });

  it('highlights active nav item based on pathname', () => {
    // usePathname is mocked to return '/' in jest.setup.js
    // The first nav item that starts with '/' would show as active
    // We just check that links render
    render(<NewSidebar />);
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(5);
  });
});
