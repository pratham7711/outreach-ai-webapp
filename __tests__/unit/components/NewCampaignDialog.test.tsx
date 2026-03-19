import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { NewCampaignDialog } from '@/components/campaigns/NewCampaignDialog';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock window.location.reload
const mockReload = jest.fn();
Object.defineProperty(window, 'location', {
  value: { reload: mockReload, href: '' },
  writable: true,
});

describe('NewCampaignDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('renders the trigger button', () => {
    render(<NewCampaignDialog />);
    expect(screen.getByText('New Campaign')).toBeInTheDocument();
  });

  it('opens dialog on trigger click', async () => {
    render(<NewCampaignDialog />);
    const trigger = screen.getByText('New Campaign');
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(screen.getByText('Create New Campaign')).toBeInTheDocument();
  });

  it('shows Campaign Name label in dialog', async () => {
    render(<NewCampaignDialog />);
    await act(async () => {
      fireEvent.click(screen.getByText('New Campaign'));
    });
    expect(screen.getByLabelText('Campaign Name')).toBeInTheDocument();
  });

  it('submit button is disabled when title is empty', async () => {
    render(<NewCampaignDialog />);
    await act(async () => {
      fireEvent.click(screen.getByText('New Campaign'));
    });
    const submitBtn = screen.getByRole('button', { name: 'Create Campaign' });
    expect(submitBtn).toBeDisabled();
  });

  it('submit button is enabled when title is entered', async () => {
    render(<NewCampaignDialog />);
    await act(async () => {
      fireEvent.click(screen.getByText('New Campaign'));
    });
    const input = screen.getByLabelText('Campaign Name');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'My New Campaign' } });
    });
    const submitBtn = screen.getByRole('button', { name: 'Create Campaign' });
    expect(submitBtn).not.toBeDisabled();
  });

  it('calls POST /api/campaigns on submit', async () => {
    render(<NewCampaignDialog />);
    await act(async () => {
      fireEvent.click(screen.getByText('New Campaign'));
    });
    const input = screen.getByLabelText('Campaign Name');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'My New Campaign' } });
    });
    const submitBtn = screen.getByRole('button', { name: 'Create Campaign' });
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/campaigns', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'My New Campaign' }),
      }));
    });
  });

  it('shows Cancel button in dialog', async () => {
    render(<NewCampaignDialog />);
    await act(async () => {
      fireEvent.click(screen.getByText('New Campaign'));
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
