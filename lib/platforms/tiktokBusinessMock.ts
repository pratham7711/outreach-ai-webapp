/**
 * Sample answers in TikTok's own response shapes, for TIKTOK_BUSINESS_MOCK=1
 * (never production; see tiktokBusinessMocked). They let every screen run
 * before the Business developer app is approved. The numbers are made up and
 * belong to no real account.
 */

const DAY = 86_400_000;

function seeded(n: number) {
  let s = n;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const POSTS = [
  { id: "7440000000000000001", caption: "Studio session, part 2. The hook finally landed #newmusic #studio", daysAgo: 2, views: 184_200, duration: 21.4 },
  { id: "7440000000000000002", caption: "Rain on the window, one take #acoustic", daysAgo: 6, views: 62_900, duration: 34.0 },
  { id: "7440000000000000003", caption: "Which version is better? Comment 1 or 2 #duet", daysAgo: 11, views: 241_700, duration: 17.8 },
  { id: "7440000000000000004", caption: "Packing for the tour, what am I forgetting?", daysAgo: 15, views: 38_400, duration: 45.2 },
  { id: "7440000000000000005", caption: "First time playing it live #livemusic", daysAgo: 21, views: 97_300, duration: 58.6 },
  { id: "7440000000000000006", caption: "Behind the cover art #design", daysAgo: 27, views: 21_800, duration: 12.1 },
];

const COMMENTS: Record<string, Array<{ id: string; user: string; text: string; likes: number; replies: number; owner?: boolean }>> = {};
for (const [i, p] of POSTS.entries()) {
  COMMENTS[p.id] = [
    { id: `${p.id}-c1`, user: "melody.maker", text: "This is the one. On repeat all day", likes: 1240 - i * 90, replies: 2 },
    { id: `${p.id}-c2`, user: "jules_sings", text: "The harmony at 0:12 😮", likes: 812 - i * 60, replies: 1 },
    { id: `${p.id}-c3`, user: "tourbus.diaries", text: "When does it come out??", likes: 433 - i * 30, replies: 0 },
    { id: `${p.id}-c4`, user: "nightowl.audio", text: "Version 2 for sure", likes: 120, replies: 0 },
  ];
}

const REPLIES: Record<string, Array<{ id: string; user: string; text: string; likes: number; owner?: boolean }>> = {};
for (const list of Object.values(COMMENTS)) {
  REPLIES[list[0].id] = [
    { id: `${list[0].id}-r1`, user: "demo.artist", text: "Thank you!! Out Friday", likes: 310, owner: true },
    { id: `${list[0].id}-r2`, user: "bassline.bea", text: "Same here", likes: 18 },
  ];
  REPLIES[list[1].id] = [{ id: `${list[1].id}-r1`, user: "demo.artist", text: "Took us nine takes", likes: 95, owner: true }];
}

/* Ad authorization codes the sample creator has switched on, held for the
   life of the dev server. */
const adCodes = new Map<string, { code: string; start: number; days: number; status: string }>([
  ["7440000000000000003", { code: "#sample-Ea2bcdUMghijEkL4mOceft5deFRq6za7Jsgn", start: Date.now() - 3 * DAY, days: 30, status: "IN_USE" }],
]);

const fmt = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");

function adBody(itemId: string) {
  const a = adCodes.get(itemId);
  if (!a) return null;
  const end = a.start + a.days * DAY;
  return {
    item_id: itemId,
    auth_code: a.code,
    auth_code_start_time: fmt(a.start),
    auth_code_end_time: fmt(end),
    authorization_days: a.days,
    auth_code_status: end < Date.now() ? "EXPIRED" : a.status,
  };
}

function sampleCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "#sample-";
  for (let i = 0; i < 40; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const tiktokBusinessMock = {
  token() {
    return {
      access_token: "sample-access-token",
      refresh_token: "sample-refresh-token",
      open_id: "sample-open-id-0001",
      scope: "user.info.basic,user.info.username,user.info.profile,user.info.stats,user.account.type,user.insights,video.list,video.insights,comment.list,biz.spark.auth",
      expires_in: 86_400,
      refresh_token_expires_in: 31_536_000,
    };
  },

  profile(start: string, end: string) {
    const rnd = seeded(7);
    const metrics = [];
    let followers = 48_200;
    for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY) {
      const gained = Math.round(120 + rnd() * 380);
      const lost = Math.round(20 + rnd() * 60);
      followers += gained - lost;
      metrics.push({
        date: new Date(t).toISOString().slice(0, 10),
        video_views: Math.round(18_000 + rnd() * 42_000),
        profile_views: Math.round(600 + rnd() * 1_400),
        likes: Math.round(2_000 + rnd() * 5_000),
        comments: Math.round(60 + rnd() * 240),
        shares: Math.round(40 + rnd() * 180),
        followers_count: followers,
        daily_new_followers: gained,
        daily_lost_followers: lost,
      });
    }
    return {
      is_business_account: false,
      has_advanced_access: true,
      username: "demo.artist",
      display_name: "Demo Artist",
      profile_image: null,
      bio_description: "Singer-songwriter. New single Friday.",
      profile_deep_link: "https://www.tiktok.com/@demo.artist",
      is_verified: false,
      followers_count: followers,
      following_count: 312,
      total_likes: 1_904_300,
      videos_count: 148,
      metrics,
      audience_ages: [
        { age: "18-24", percentage: 0.46 },
        { age: "25-34", percentage: 0.31 },
        { age: "35-44", percentage: 0.13 },
        { age: "45-54", percentage: 0.06 },
        { age: "55+", percentage: 0.04 },
      ],
      audience_genders: [
        { gender: "Female", percentage: 0.58 },
        { gender: "Male", percentage: 0.39 },
        { gender: "Other", percentage: 0.03 },
      ],
      audience_countries: [
        { country: "US", percentage: 0.41 },
        { country: "GB", percentage: 0.14 },
        { country: "IN", percentage: 0.11 },
        { country: "CA", percentage: 0.08 },
        { country: "AU", percentage: 0.06 },
      ],
    };
  },

  posts() {
    return POSTS.map((p, i) => {
      const rnd = seeded(100 + i);
      const avg = p.duration * (0.35 + rnd() * 0.3);
      const retention = [];
      for (let s = 0; s <= Math.floor(p.duration); s += Math.max(1, Math.floor(p.duration / 12))) {
        retention.push({ second: String(s), percentage: Math.max(0.04, Math.exp(-s / (p.duration * 0.55))) });
      }
      return {
        item_id: p.id,
        media_type: "VIDEO",
        is_ad: adCodes.get(p.id)?.status === "IN_USE",
        thumbnail_url: null,
        share_url: `https://www.tiktok.com/@demo.artist/video/${p.id}`,
        caption: p.caption,
        create_time: String(Math.floor((Date.now() - p.daysAgo * DAY) / 1000)),
        video_duration: p.duration,
        video_views: p.views,
        likes: Math.round(p.views * (0.07 + rnd() * 0.05)),
        comments: Math.round(p.views * (0.003 + rnd() * 0.004)),
        shares: Math.round(p.views * (0.004 + rnd() * 0.006)),
        reach: Math.round(p.views * 0.78),
        total_time_watched: Math.round(p.views * avg),
        average_time_watched: Math.round(avg * 10) / 10,
        full_video_watched_rate: Math.round((0.12 + rnd() * 0.2) * 1000) / 1000,
        new_followers: Math.round(p.views * 0.004),
        video_view_retention: retention,
        impression_sources: [
          { impression_source: "For You", percentage: 0.72 - i * 0.02 },
          { impression_source: "Personal Profile", percentage: 0.11 },
          { impression_source: "Follow", percentage: 0.09 + i * 0.02 },
          { impression_source: "Search", percentage: 0.05 },
          { impression_source: "Sound", percentage: 0.03 },
        ],
        audience_genders: [
          { gender: "Female", percentage: 0.6 },
          { gender: "Male", percentage: 0.37 },
          { gender: "Other", percentage: 0.03 },
        ],
        audience_countries: [
          { country: "US", percentage: 0.44 },
          { country: "GB", percentage: 0.12 },
          { country: "IN", percentage: 0.1 },
        ],
      };
    });
  },

  comments(videoId: string) {
    const p = POSTS.find((x) => x.id === videoId);
    return (COMMENTS[videoId] ?? []).map((c, i) => ({
      comment_id: c.id,
      video_id: videoId,
      create_time: String(Math.floor((Date.now() - ((p?.daysAgo ?? 1) * DAY - (i + 1) * 3_600_000)) / 1000)),
      text: c.text,
      likes: Math.max(0, c.likes),
      replies: c.replies,
      owner: c.owner === true,
      liked: i === 0,
      pinned: i === 0,
      status: "PUBLIC",
      username: c.user,
    }));
  },

  replies(commentId: string) {
    return (REPLIES[commentId] ?? []).map((r, i) => ({
      comment_id: r.id,
      create_time: String(Math.floor((Date.now() - (i + 1) * 1_800_000) / 1000)),
      text: r.text,
      likes: r.likes,
      replies: 0,
      owner: r.owner === true,
      status: "PUBLIC",
      username: r.user,
    }));
  },

  adStatus(itemId: string) {
    return adBody(itemId);
  },

  enable(itemId: string, days: number) {
    adCodes.set(itemId, { code: sampleCode(), start: Date.now(), days, status: "NOT_USED" });
    return adBody(itemId);
  },

  extend(itemId: string, days: number) {
    const a = adCodes.get(itemId);
    if (a) adCodes.set(itemId, { ...a, days: a.days + days });
    return adBody(itemId);
  },

  remove(itemId: string) {
    adCodes.delete(itemId);
  },
};
