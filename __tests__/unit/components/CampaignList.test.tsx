import { render, screen } from '@testing-library/react';
import { CampaignList } from '@/components/campaigns/CampaignList';
import type { CampaignWithRelations } from '@/types';

const makeCampaign = (overrides: Partial<CampaignWithRelations> = {}): CampaignWithRelations => ({
  id: 'camp-1',
  orgId: 'org-1',
  title: 'Test Campaign',
  status: 'DRAFT',
  thumbnailUrl: null,
  budget: null,
  currency: 'USD',
  notes: null,
  clientId: null,
  folderId: null,
  createdById: 'user-1',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  deletedAt: null,
  tags: [],
  teamMembers: [],
  _count: { activations: 0, posts: 0 },
  ...overrides,
});

describe('CampaignList', () => {
  it('shows empty state when no campaigns', () => {
    render(<CampaignList campaigns={[]} />);
    expect(screen.getByText('No campaigns found')).toBeInTheDocument();
    expect(screen.getByText('Create your first campaign to get started')).toBeInTheDocument();
  });

  it('renders a single campaign card', () => {
    render(<CampaignList campaigns={[makeCampaign()]} />);
    expect(screen.getByText('Test Campaign')).toBeInTheDocument();
  });

  it('renders multiple campaign cards', () => {
    const campaigns = [
      makeCampaign({ id: 'camp-1', title: 'Alpha Campaign' }),
      makeCampaign({ id: 'camp-2', title: 'Beta Campaign' }),
      makeCampaign({ id: 'camp-3', title: 'Gamma Campaign' }),
    ];
    render(<CampaignList campaigns={campaigns} />);
    expect(screen.getByText('Alpha Campaign')).toBeInTheDocument();
    expect(screen.getByText('Beta Campaign')).toBeInTheDocument();
    expect(screen.getByText('Gamma Campaign')).toBeInTheDocument();
  });

  it('does not show empty state when campaigns exist', () => {
    render(<CampaignList campaigns={[makeCampaign()]} />);
    expect(screen.queryByText('No campaigns found')).not.toBeInTheDocument();
  });
});
