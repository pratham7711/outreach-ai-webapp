import { render, screen } from '@testing-library/react';
import { CampaignDetail } from '@/components/campaigns/CampaignDetail';
import type { CampaignWithRelations } from '@/types';

const baseCampaign: CampaignWithRelations = {
  id: 'camp-1',
  orgId: 'org-1',
  title: 'Q4 Influencer Push',
  status: 'IN_PROGRESS',
  thumbnailUrl: null,
  budget: '50000',
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
  _count: { activations: 12, posts: 45 },
};

describe('CampaignDetail', () => {
  it('renders campaign title', () => {
    render(<CampaignDetail campaign={baseCampaign} />);
    expect(screen.getByText('Q4 Influencer Push')).toBeInTheDocument();
  });

  it('shows status badge label', () => {
    render(<CampaignDetail campaign={baseCampaign} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('shows activation count', () => {
    render(<CampaignDetail campaign={baseCampaign} />);
    expect(screen.getByText(/12 creators/)).toBeInTheDocument();
  });

  it('shows post count', () => {
    render(<CampaignDetail campaign={baseCampaign} />);
    expect(screen.getByText(/45 posts/)).toBeInTheDocument();
  });

  it('shows DRAFT status badge', () => {
    render(<CampaignDetail campaign={{ ...baseCampaign, status: 'DRAFT' }} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('shows COMPLETE status badge', () => {
    render(<CampaignDetail campaign={{ ...baseCampaign, status: 'COMPLETE' }} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });
});
