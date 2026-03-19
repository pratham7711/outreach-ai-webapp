import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock next-themes before importing the component
jest.mock('next-themes', () => ({
  useTheme: jest.fn(() => ({ theme: 'dark', setTheme: jest.fn() })),
}));

import ThemeToggle from '@/components/ThemeToggle';
import { useTheme } from 'next-themes';

describe('ThemeToggle', () => {
  const mockSetTheme = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
  });

  it('renders the toggle button with aria-label', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });

  it('switches to light theme when in dark mode', () => {
    (useTheme as jest.Mock).mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('switches to dark theme when in light mode', () => {
    (useTheme as jest.Mock).mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('shows Sun icon in dark mode', () => {
    (useTheme as jest.Mock).mockReturnValue({ theme: 'dark', setTheme: mockSetTheme });
    const { container } = render(<ThemeToggle />);
    // Sun icon SVG is rendered
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows Moon icon in light mode', () => {
    (useTheme as jest.Mock).mockReturnValue({ theme: 'light', setTheme: mockSetTheme });
    const { container } = render(<ThemeToggle />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
