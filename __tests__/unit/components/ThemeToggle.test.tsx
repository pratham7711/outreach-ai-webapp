import { render, screen, fireEvent } from '@testing-library/react';

// Mock next-themes before importing the component
jest.mock('next-themes', () => ({
  useTheme: jest.fn(() => ({ resolvedTheme: "dark", setTheme: jest.fn() })),
}));

import ThemeToggle from '@/components/ThemeToggle';
import { useTheme } from 'next-themes';

describe('ThemeToggle', () => {
  const mockSetTheme = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: "dark", setTheme: mockSetTheme });
  });

  // light -> dark -> creatorcore -> light
  it.each([
    ["light", "Switch to Dark mode", "dark"],
    ["dark", "Switch to CreatorCore mode", "creatorcore"],
    ["creatorcore", "Switch to Light mode", "light"],
  ])('from %s it offers %s', (resolvedTheme, label, expected) => {
    (useTheme as jest.Mock).mockReturnValue({ resolvedTheme, setTheme: mockSetTheme });
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: label });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(mockSetTheme).toHaveBeenCalledWith(expected);
  });

  it('falls back to the first step for an unknown theme', () => {
    (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: undefined, setTheme: mockSetTheme });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Dark mode' }));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('renders an icon for the current theme', () => {
    (useTheme as jest.Mock).mockReturnValue({ resolvedTheme: "dark", setTheme: mockSetTheme });
    const { container } = render(<ThemeToggle />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
