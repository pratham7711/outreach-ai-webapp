import { render, screen } from '@testing-library/react';

// Mock next-themes for NewSidebar → ThemeToggle
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: jest.fn() }),
}));

import { DashboardLayout } from '@/components/layout/DashboardLayout';

describe('DashboardLayout', () => {
  it('renders children content', () => {
    render(
      <DashboardLayout>
        <div>Test Content</div>
      </DashboardLayout>
    );
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('renders the sidebar', () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );
    // Sidebar renders the brand name
    expect(screen.getByText('CampaignHub')).toBeInTheDocument();
  });

  it('renders the top navigation', () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );
    // TopNav renders the search input
    expect(screen.getByPlaceholderText('Search everything...')).toBeInTheDocument();
  });

  it('wraps content in main element', () => {
    render(
      <DashboardLayout>
        <p>Main Content</p>
      </DashboardLayout>
    );
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toHaveTextContent('Main Content');
  });
});
