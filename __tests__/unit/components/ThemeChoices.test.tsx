import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('next-themes', () => ({
  useTheme: jest.fn(() => ({ theme: 'light', setTheme: jest.fn() })),
}));

import { ThemeRadioGroup, THEME_CHOICES } from '@/components/ThemeChoices';
import { useTheme } from 'next-themes';

describe('ThemeRadioGroup', () => {
  const setTheme = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ theme: 'light', setTheme });
  });

  it('offers CreatorCore, Light, Dark and System, in that order', () => {
    render(<ThemeRadioGroup />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['CreatorCore', 'Light', 'Dark', 'System']);
  });

  it('keeps the theme names next-themes already saved', () => {
    expect(THEME_CHOICES.map((c) => c.key)).toEqual(['creatorcore', 'light', 'dark', 'system']);
  });

  it.each([
    ['creatorcore', 'CreatorCore'],
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'System'],
  ])('marks %s as the checked choice', (theme, label) => {
    (useTheme as jest.Mock).mockReturnValue({ theme, setTheme });
    render(<ThemeRadioGroup />);
    const checked = screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.map((r) => r.textContent)).toEqual([label]);
  });

  it('treats an unset theme as System', () => {
    (useTheme as jest.Mock).mockReturnValue({ theme: undefined, setTheme });
    render(<ThemeRadioGroup />);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  });

  it('saves the chosen theme', () => {
    render(<ThemeRadioGroup />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('is labelled as the theme group', () => {
    render(<ThemeRadioGroup />);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });
});
