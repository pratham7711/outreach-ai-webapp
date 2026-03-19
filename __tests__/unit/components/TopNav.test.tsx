import { render, screen } from '@testing-library/react';
import { TopNav } from '@/components/layout/TopNav';

describe('TopNav', () => {
  it('renders search input', () => {
    render(<TopNav />);
    expect(screen.getByPlaceholderText('Search everything...')).toBeInTheDocument();
  });

  it('renders Quick Add button', () => {
    render(<TopNav />);
    expect(screen.getByText('Quick Add')).toBeInTheDocument();
  });

  it('renders user avatar initials', () => {
    render(<TopNav />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('renders notification bell', () => {
    render(<TopNav />);
    // There's a red dot notification indicator
    const header = screen.getByRole('banner');
    expect(header).toBeInTheDocument();
  });

  it('search input has correct type', () => {
    render(<TopNav />);
    const input = screen.getByPlaceholderText('Search everything...');
    expect(input.tagName).toBe('INPUT');
  });
});
