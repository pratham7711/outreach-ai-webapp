import React from 'react';
import { render, screen } from '@testing-library/react';
import { CampaignCard } from '@/components/campaigns/CampaignCard';
import type { CampaignWithRelations } from '@/types';

// Mock base-ui backed components to avoid jsdom compatibility issues
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: any) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}));
jest.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children, className }: any) => (
    <div data-testid="avatar" className={className}>{children}</div>
  ),
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

const baseCampaign: CampaignWithRelations = {
  id: 'camp-1',
  orgId: 'org-1',
  title: 'Summer Launch 2025',
  status: 'IN_PROGRESS',
  thumbnailUrl: null,
  budget: '25000',
  currency: 'USD',
  notes: null,
  clientId: null,
  folderId: null,
  createdById: 'user-1',
  createdAt: new Date('2025-03-01'),
  updatedAt: new Date('2025-03-05'),
  deletedAt: null,
  tags: [],
  teamMembers: [],
  _count: { activations: 3, posts: 7 },
};

describe('CampaignCard', () => {
  it('renders campaign title', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('Summer Launch 2025')).toBeInTheDocument();
  });

  it('shows correct status label for IN_PROGRESS', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('shows DRAFT status correctly', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, status: 'DRAFT' }} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('shows PENDING status correctly', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, status: 'PENDING' }} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('shows COMPLETE status correctly', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, status: 'COMPLETE' }} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('shows CANCELLED status correctly', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, status: 'CANCELLED' }} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('displays budget with USD symbol', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText(/^\$25/)).toBeInTheDocument();
  });

  it('renders dash for null budget', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, budget: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('displays EUR currency symbol', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, currency: 'EUR' }} />);
    expect(screen.getByText(/^€/)).toBeInTheDocument();
  });

  it('shows creator count', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('3 creators')).toBeInTheDocument();
  });

  it('shows post count', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('7 posts')).toBeInTheDocument();
  });

  it('renders tags', () => {
    const campaign = {
      ...baseCampaign,
      tags: [
        { campaignId: 'camp-1', tag: 'summer' },
        { campaignId: 'camp-1', tag: 'launch' },
      ],
    };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByText('summer')).toBeInTheDocument();
    expect(screen.getByText('launch')).toBeInTheDocument();
  });

  it('shows +N indicator when more than 3 tags', () => {
    const campaign = {
      ...baseCampaign,
      tags: [
        { campaignId: 'camp-1', tag: 'tag1' },
        { campaignId: 'camp-1', tag: 'tag2' },
        { campaignId: 'camp-1', tag: 'tag3' },
        { campaignId: 'camp-1', tag: 'tag4' },
      ],
    };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('renders team member initials', () => {
    const campaign = {
      ...baseCampaign,
      teamMembers: [
        { id: 'tm-1', user: { id: 'u-1', name: 'John Doe', avatarUrl: null } },
      ],
    };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });

  it('shows +N for more than 3 team members', () => {
    const campaign = {
      ...baseCampaign,
      teamMembers: [
        { id: 'tm-1', user: { id: 'u-1', name: 'Alice Aa', avatarUrl: null } },
        { id: 'tm-2', user: { id: 'u-2', name: 'Bob Bb', avatarUrl: null } },
        { id: 'tm-3', user: { id: 'u-3', name: 'Carol Cc', avatarUrl: null } },
        { id: 'tm-4', user: { id: 'u-4', name: 'Dave Dd', avatarUrl: null } },
      ],
    };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('renders thumbnail image when provided', () => {
    const campaign = { ...baseCampaign, thumbnailUrl: 'https://example.com/thumb.jpg' };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByAltText('Summer Launch 2025')).toBeInTheDocument();
  });

  it('renders first letter of title when no thumbnail', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    // The first letter 'S' should appear in the thumbnail placeholder
    const firstLetters = screen.getAllByText('S');
    expect(firstLetters.length).toBeGreaterThan(0);
  });
});
