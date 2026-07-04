export type CreatorProfile = {
  followersCount: number;
  avgViews?: number;
  rate?: number;
};

export type ProposeCounterInput = {
  offeredRate: number;
  creatorCounterRate: number;
  creatorProfile: CreatorProfile;
  campaignBrief?: string;
  currency: string;
};

export type ProposeCounterResult = {
  counterRate: number;
  message: string;
};

export interface NegotiationAdvisor {
  proposeCounter(input: ProposeCounterInput): Promise<ProposeCounterResult>;
}
