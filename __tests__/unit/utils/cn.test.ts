import { cn } from '@/lib/utils';

describe('cn utility', () => {
  it('merges classnames correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn('base', isActive && 'active', isDisabled && 'disabled')).toBe('base active');
  });

  it('trims extra whitespace', () => {
    expect(cn('  foo  ', '  bar  ')).toBe('foo bar');
  });
});
