import { render, screen } from '@testing-library/react';

// Mock recharts as it uses browser-only APIs not available in jsdom
jest.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cart-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}));

import MonthlySpendChart from '@/components/charts/MonthlySpendChart';

const sampleData = [
  { month: 'Jan', spend: 10000 },
  { month: 'Feb', spend: 15000 },
  { month: 'Mar', spend: 8000 },
  { month: 'Apr', spend: 22000 },
];

describe('MonthlySpendChart', () => {
  it('renders the chart container', () => {
    render(<MonthlySpendChart data={sampleData} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders a BarChart', () => {
    render(<MonthlySpendChart data={sampleData} />);
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('renders with empty data array', () => {
    render(<MonthlySpendChart data={[]} />);
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders XAxis and YAxis', () => {
    render(<MonthlySpendChart data={sampleData} />);
    expect(screen.getByTestId('x-axis')).toBeInTheDocument();
    expect(screen.getByTestId('y-axis')).toBeInTheDocument();
  });

  it('renders Bar component', () => {
    render(<MonthlySpendChart data={sampleData} />);
    expect(screen.getByTestId('bar')).toBeInTheDocument();
  });
});
