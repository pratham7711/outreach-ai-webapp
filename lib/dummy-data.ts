export const CAMPAIGNS = [
  { id: "c1", name: "Summer Glow 2026", brand: "Glossier", status: "active", budget: 42000, spent: 28500, creators: 12, startDate: "2026-06-01", endDate: "2026-07-31", views: 3400000, engagement: 8.2 },
  { id: "c2", name: "Back to School", brand: "Nike", status: "active", budget: 65000, spent: 41000, creators: 8, startDate: "2026-07-15", endDate: "2026-08-31", views: 5100000, engagement: 6.9 },
  { id: "c3", name: "Fall Collection Drop", brand: "Zara", status: "draft", budget: 28000, spent: 0, creators: 5, startDate: "2026-09-01", endDate: "2026-09-30", views: 0, engagement: 0 },
  { id: "c4", name: "Hydration Challenge", brand: "LMNT", status: "completed", budget: 18000, spent: 17800, creators: 6, startDate: "2026-04-01", endDate: "2026-04-30", views: 2200000, engagement: 11.4 },
  { id: "c5", name: "Sound Drop Vol. 3", brand: "Spotify", status: "active", budget: 55000, spent: 22000, creators: 15, startDate: "2026-05-20", endDate: "2026-06-30", views: 7800000, engagement: 9.1 },
];

export const CREATORS = [
  { id: "cr1", name: "Aria Rose", handle: "@aria.rose", platform: "Instagram", followers: 1200000, engagement: 9.8, niche: "Lifestyle", avatar: "AR", campaigns: 3, totalPaid: 12400, status: "active" },
  { id: "cr2", name: "Jake Mercer", handle: "@jakemercer", platform: "TikTok", followers: 3400000, engagement: 14.2, niche: "Fitness", avatar: "JM", campaigns: 5, totalPaid: 28000, status: "active" },
  { id: "cr3", name: "Sofia Vega", handle: "@sofiavega", platform: "YouTube", followers: 890000, engagement: 7.1, niche: "Beauty", avatar: "SV", campaigns: 2, totalPaid: 9600, status: "invited" },
  { id: "cr4", name: "Kai Torres", handle: "@kaitorres", platform: "TikTok", followers: 2100000, engagement: 12.5, niche: "Tech", avatar: "KT", campaigns: 4, totalPaid: 19200, status: "active" },
  { id: "cr5", name: "Priya Sharma", handle: "@priyasharma", platform: "Instagram", followers: 650000, engagement: 8.3, niche: "Food", avatar: "PS", campaigns: 1, totalPaid: 4800, status: "active" },
  { id: "cr6", name: "Marcus Webb", handle: "@marcuswebb", platform: "YouTube", followers: 1800000, engagement: 6.4, niche: "Gaming", avatar: "MW", campaigns: 2, totalPaid: 15600, status: "active" },
];

export const PAYOUTS = [
  { id: "p1", creator: "Jake Mercer", campaign: "Back to School", amount: 4800, status: "sent", date: "2026-07-01" },
  { id: "p2", creator: "Aria Rose", campaign: "Summer Glow 2026", amount: 2400, status: "sent", date: "2026-06-28" },
  { id: "p3", creator: "Sofia Vega", campaign: "Sound Drop Vol. 3", amount: 3200, status: "pending", date: "2026-07-10" },
  { id: "p4", creator: "Kai Torres", campaign: "Summer Glow 2026", amount: 1800, status: "processing", date: "2026-07-08" },
  { id: "p5", creator: "Priya Sharma", campaign: "Hydration Challenge", amount: 2200, status: "sent", date: "2026-05-02" },
  { id: "p6", creator: "Marcus Webb", campaign: "Back to School", amount: 5600, status: "pending", date: "2026-07-12" },
];

export const ACTIVITY = [
  { id: "a1", type: "payout", text: "Payout of $2,400 sent to Aria Rose", time: "2 hours ago", icon: "💸" },
  { id: "a2", type: "contract", text: "Sofia Vega signed campaign contract", time: "4 hours ago", icon: "✍️" },
  { id: "a3", type: "campaign", text: "Fall Collection Drop campaign created", time: "Yesterday", icon: "🎯" },
  { id: "a4", type: "creator", text: "Marcus Webb added to Back to School", time: "Yesterday", icon: "👤" },
  { id: "a5", type: "report", text: "Summer Glow weekly report ready", time: "2 days ago", icon: "📊" },
];

export const CHART_DATA = [
  { month: "Feb", campaigns: 3, creators: 18, spend: 28000 },
  { month: "Mar", campaigns: 5, creators: 24, spend: 42000 },
  { month: "Apr", campaigns: 4, creators: 21, spend: 35000 },
  { month: "May", campaigns: 7, creators: 38, spend: 61000 },
  { month: "Jun", campaigns: 6, creators: 35, spend: 55000 },
  { month: "Jul", campaigns: 8, creators: 44, spend: 72000 },
];
