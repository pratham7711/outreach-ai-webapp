import { render, screen } from '@testing-library/react';
import CampaignCard from '@/components/CampaignCard';

// Mock the next/navigation hooks used in CampaignCard
jest.mock('@/lib/utils', () => ({
  cn: (...args) => args.filter(Boolean).join(' '),
}));

describe('CampaignCard', () => {
  const mockCampaign = {
    id: 'camp-1',
    title: 'Summer Launch 2025',
    status: 'IN_PROGRESS',
    thumbnailUrl: '/thumb.jpg',
    budget: 25000,
    currency: 'USD',
    createdAt: new Date('2025-03-01'),
    updatedAt: new Date('2025-03-05'),
  };

  it('renders campaign title', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('Summer Launch 2025')).toBeInTheDocument();
  });

  it('displays budget in correct currency', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('$25,000.00')).toBeInTheDocument();
  });

  it('shows status badge', () => {
    render(<CampaignCard campaign={mockCampaign} />);
    expect(screen.getByText('IN_PROGRESS')).toBeInTheDocument();
  });

  it('navigates to campaign detail on click', () => {
    const push = jest.fn();
    jest.doMock('next/navigation', () => ({
      useRouter: () => ({ push }),
    }));
    render(<CampaignCard campaign={mockCampaign} />);
    expect(push).toHaveBeenCalledWith('/campaigns/camp-1');
  });
});
