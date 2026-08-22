export type MetricDefinition = {
  label: string;
  what: string;
  how?: string;
};

export const METRIC_DEFINITIONS = {
  campaigns: {
    label: "Campaigns",
    what: "How many campaigns your team has created in total, including drafts and finished ones.",
    how: "Counts every campaign that has not been deleted.",
  },
  activeCampaigns: {
    label: "Active campaigns",
    what: "Campaigns currently running, where creators can still post and earn.",
    how: "Campaigns with the status Active.",
  },
  creators: {
    label: "Creators",
    what: "How many creators are saved in your roster and available to invite to a campaign.",
    how: "Counts every creator in your organisation that has not been deleted.",
  },
  pendingPayouts: {
    label: "Pending payouts",
    what: "Money you owe creators that has been approved but not paid out yet.",
    how: "Adds up the amount of every payout still marked Pending.",
  },
  totalPaid: {
    label: "Total paid",
    what: "Money that has actually reached creators. This is real spend, not a forecast.",
    how: "Adds up the amount of every payout marked Success.",
  },
  processingPayouts: {
    label: "Processing",
    what: "Payments already sent to the bank or wallet but not yet confirmed. They usually settle within a few days.",
    how: "Adds up the amount of every payout marked Processing.",
  },
  failedPayouts: {
    label: "Failed",
    what: "Payments that did not go through, usually because of wrong payout details. These need you to act.",
    how: "Adds up the amount of every payout marked Failed.",
  },
  monthlySpend: {
    label: "Monthly spend",
    what: "What you actually paid creators each month, so you can see whether spend is climbing or flattening.",
    how: "Groups all payouts by the month they were created and adds up their amounts.",
  },
  totalSpend: {
    label: "Total spend",
    what: "Everything paid out to creators so far on this campaign.",
    how: "Adds up all payouts linked to the campaign.",
  },
  budget: {
    label: "Budget",
    what: "The maximum you planned to spend on this campaign.",
    how: "Set by your team when the campaign was created.",
  },
  budgetRemaining: {
    label: "Budget remaining",
    what: "How much of the planned budget you have left before you hit the cap.",
    how: "Budget minus total spend.",
  },
  views: {
    label: "Views",
    what: "How many times creator posts in this campaign were watched.",
    how: "Adds up the latest view count recorded for every tracked post.",
  },
  engagementRate: {
    label: "Engagement rate",
    what: "How actively people responded to the posts, rather than just scrolling past. Higher usually means the content landed.",
    how: "Likes plus comments plus shares, divided by views.",
  },
  cpm: {
    label: "Cost per 1,000 views",
    what: "What you paid for every thousand views. Lower means you got more attention for your money.",
    how: "Total spend divided by views, multiplied by 1,000.",
  },
  posts: {
    label: "Posts",
    what: "How many pieces of content creators have published for this campaign.",
    how: "Counts every post submitted and accepted against the campaign.",
  },
  activations: {
    label: "Activations",
    what: "Creators who accepted an invite and are cleared to post for a campaign.",
    how: "Counts creator-to-campaign assignments.",
  },
  avgViewsPerPost: {
    label: "Average views per post",
    what: "Typical reach of a single post, useful for predicting what the next post will do.",
    how: "Views divided by number of posts.",
  },
  paidCreators: {
    label: "Paid creators",
    what: "How many different creators have actually been paid in the selected date range.",
    how: "Counts each creator once if they received at least one payout in range.",
  },
  totalBudget: {
    label: "Total budget",
    what: "Everything your team has committed across all campaigns in this date range.",
    how: "Adds up the budget of every campaign in range.",
  },
  avgCampaignSpend: {
    label: "Average campaign spend",
    what: "What a typical campaign costs you, useful for planning the next one.",
    how: "Total spend divided by the number of campaigns.",
  },
  totalDeposits: {
    label: "Total deposits",
    what: "Money placed into escrow up front to cover creator payments.",
    how: "Adds up every deposit recorded against your campaigns.",
  },
  releasedDeposits: {
    label: "Released deposits",
    what: "Escrow money already handed over to creators after their work was approved.",
    how: "Adds up deposits marked as released.",
  },
  totalViews: {
    label: "Total views",
    what: "How many times your creators' posts were watched, across every campaign in the selected range.",
    how: "Adds up the latest view count of every tracked post.",
  },
  totalLikes: {
    label: "Total likes",
    what: "Likes across all tracked posts. A quick read on whether people liked what they saw.",
    how: "Adds up the like count of every tracked post.",
  },
  totalComments: {
    label: "Total comments",
    what: "Comments across all tracked posts. Comments take more effort than a like, so they signal stronger interest.",
    how: "Adds up the comment count of every tracked post.",
  },
  totalPosts: {
    label: "Total posts",
    what: "How many pieces of content your creators published in the selected range.",
    how: "Counts every tracked post.",
  },
  livePosts: {
    label: "Live posts",
    what: "How many of the tracked posts are still up on their platform. A creator deleting a post does not remove it from the campaign, so this can be lower than total posts.",
    how: "Counts posts last inspected as live. Absent entirely until at least one post on the campaign has been inspected, because an uninspected post is neither known-live nor known-gone.",
  },
  totalShares: {
    label: "Total shares",
    what: "How often people sent the posts to someone else. A share reaches an audience the post was never served to.",
    how: "Adds up the share count of every tracked post.",
  },
  totalSaves: {
    label: "Total saves",
    what: "How often people bookmarked a post to come back to. Saves track intent better than likes do.",
    how: "Adds up the save count of every tracked post that reports one.",
  },
  totalDownloads: {
    label: "Total downloads",
    what: "How often the video itself was downloaded, which is how sounds travel off-platform.",
    how: "Adds up the download count of every tracked post that reports one.",
  },
  avgEngagementRate: {
    label: "Average engagement rate",
    what: "How actively people responded rather than just scrolling past. Higher usually means the content landed.",
    how: "Likes plus comments plus shares, divided by views, averaged across posts.",
  },
  avgCPM: {
    label: "Average cost per 1,000 views",
    what: "What you paid for every thousand views. Lower is better — you got more attention for the same money.",
    how: "Total spend divided by total views, multiplied by 1,000.",
  },
  activationsTotal: {
    label: "Total",
    what: "Every creator booking on this page, whatever stage it has reached.",
    how: "Counts all activations, including finished and cancelled ones.",
  },
  activationsActive: {
    label: "Active",
    what: "Bookings where the creator is cleared to post and the work is still in progress.",
    how: "Counts activations with the status Active.",
  },
  activationsPending: {
    label: "Pending",
    what: "Bookings waiting on someone — either the creator has not sent a draft, or you have not approved one. These are the ones to chase.",
    how: "Counts activations awaiting a draft or awaiting approval.",
  },
  activationsComplete: {
    label: "Complete",
    what: "Bookings where the creator posted and the work was signed off.",
    how: "Counts activations with the status Complete.",
  },
  campaignCreators: {
    label: "Creators",
    what: "How many creators are cleared to post on this campaign.",
    how: "Counts the activations attached to this campaign.",
  },
  budgetUsed: {
    label: "Budget used",
    what: "How much of this campaign's planned budget you have already committed. Watch this before adding creators.",
    how: "Spend divided by budget, shown as a percentage.",
  },
  engagements: {
    label: "Engagements",
    what: "Every deliberate interaction with the posts — likes, comments and shares added together.",
    how: "Adds up likes, comments and shares across tracked posts.",
  },
  spendPaid: {
    label: "Spend (paid)",
    what: "Money that has actually reached creators on this campaign. This figure is real spend, not a plan.",
    how: "Adds up payouts marked Success.",
  },
  spendAccrued: {
    label: "Spend (accrued)",
    what: "Money creators have earned on this campaign so far, whether or not it has been disbursed yet. On a view-based campaign this is the real cost to date.",
    how: "Adds up every view-ledger entry's earned amount for this campaign.",
  },
  spendBudget: {
    label: "Spend (budget)",
    what: "Estimated spend based on the campaign budget, shown because no payouts have been paid yet.",
    how: "Falls back to the campaign budget when there are no paid payouts.",
  },
  cpmCpe: {
    label: "CPM / CPE",
    what: "What you paid per thousand views, and per single engagement. Lower is better on both.",
    how: "Spend divided by views times 1,000, and spend divided by engagements.",
  },
  emv: {
    label: "EMV",
    what: "Earned media value — a rough estimate of what this reach would have cost you as paid advertising. Useful for a headline number, not for accounting.",
    how: "Applies a standard rate card to the views and engagements recorded.",
  },
  clientsTotal: {
    label: "Total clients",
    what: "How many brands or companies you are running campaigns for.",
    how: "Counts every client in your organisation.",
  },
  followers: {
    label: "Followers",
    what: "The size of this creator's audience on their main platform.",
    how: "Latest follower count recorded for the creator.",
  },
  creatorCampaigns: {
    label: "Campaigns",
    what: "How many of your campaigns this creator has been booked on.",
    how: "Counts the creator's activations.",
  },
  creatorEarnings: {
    label: "Total earnings",
    what: "What this creator has been paid by you across every campaign.",
    how: "Adds up payouts to this creator marked Success.",
  },
  recipients: {
    label: "Recipients",
    what: "How many people you hold payout details for and can pay without extra setup.",
    how: "Counts saved payout recipients in your organisation.",
  },
  requestsTotal: {
    label: "Total requests",
    what: "Every payment request creators have sent you, at any stage.",
    how: "Counts all payout requests.",
  },
  requestsPending: {
    label: "Pending",
    what: "Requests still waiting on your decision. Creators are not paid until you approve these.",
    how: "Counts payout requests awaiting review.",
  },
  requestsApprovedAmount: {
    label: "Approved amount",
    what: "Total value of requests you have approved. This is what you have committed to pay.",
    how: "Adds up the amount of every approved payout request.",
  },
  requestsRejected: {
    label: "Rejected",
    what: "Requests you turned down, usually because the work or the amount did not match the brief.",
    how: "Counts payout requests marked Rejected.",
  },
  ingestionTotalPosts: {
    label: "Total posts",
    what: "How many creator posts this platform connection is tracking.",
    how: "Counts every post recorded for the platform.",
  },
  ingestionSynced24h: {
    label: "Synced last 24h",
    what: "Posts whose numbers were refreshed in the last day. A healthy connection keeps most posts here.",
    how: "Counts posts with a successful sync in the last 24 hours.",
  },
  ingestionNeverSynced: {
    label: "Never synced",
    what: "Posts added but never successfully fetched, so their view counts are still empty. Usually a permissions or link problem.",
    how: "Counts posts with no successful sync on record.",
  },
  ingestionDeadLettered: {
    label: "Dead-lettered",
    what: "Posts that failed to sync repeatedly and were parked so they stop blocking the queue. These need a look.",
    how: "Counts posts moved to the dead-letter queue after repeated failures.",
  },
  trackersActive: {
    label: "Active trackers",
    what: "Sounds and hashtags you are currently watching for campaign ideas.",
    how: "Counts trackers that have not been archived.",
  },
  trackerUses: {
    label: "Total uses",
    what: "How many posts across the platform use the things you track. A proxy for how big a trend is.",
    how: "Adds up the recorded use count of every tracker.",
  },
  trackersTrending: {
    label: "Trending",
    what: "Trackers whose usage is climbing right now — the ones worth briefing creators on this week.",
    how: "Counts trackers flagged as trending on the latest refresh.",
  },
  trackersNewToday: {
    label: "New today",
    what: "Uses picked up since this morning, so you can see whether a trend is still accelerating.",
    how: "Counts uses first recorded today.",
  },
  portalLifetimeEarnings: {
    label: "Lifetime earnings",
    what: "Everything you have been paid through this platform, across every campaign.",
    how: "Adds up your payouts marked Success.",
  },
  portalProposals: {
    label: "Total proposals",
    what: "How many campaigns you have applied to or been invited to.",
    how: "Counts every proposal linked to your account.",
  },
  portalAccepted: {
    label: "Accepted",
    what: "Proposals that turned into confirmed work.",
    how: "Counts proposals with the status Accepted.",
  },
  portalAvailableBalance: {
    label: "Available balance",
    what: "Money approved for you that you can request a payout against right now.",
    how: "Adds up your approved, unpaid earnings.",
  },
  portalPendingReview: {
    label: "Pending review",
    what: "Earnings submitted but not yet approved. These become available once the campaign manager signs them off.",
    how: "Adds up earnings still awaiting review.",
  },
  portalTotalRequested: {
    label: "Total requested",
    what: "The total value of payouts you have asked for, at any stage.",
    how: "Adds up the amount of every payout request you have sent.",
  },
  portalApproved: {
    label: "Approved",
    what: "Requests signed off and queued for payment.",
    how: "Counts your payout requests marked Approved.",
  },
  portalRejected: {
    label: "Rejected",
    what: "Requests that were turned down. Open one to see the reason given.",
    how: "Counts your payout requests marked Rejected.",
  },
  paidPayouts: {
    label: "Paid payouts",
    what: "Money that actually left your account and reached creators in this period.",
    how: "Adds up payouts marked Success within the selected date range.",
  },
} satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

export const SPEND_METRIC_BY_SOURCE = {
  PAID_PAYOUTS: "spendPaid",
  ACCRUED_LEDGER: "spendAccrued",
  BUDGET: "spendBudget",
} as const satisfies Record<string, MetricKey>;
