const YT_CHANNEL = "UCwdBkA1Xf2aLmM76aSOLZ1A";
const TT_USER = "zaytos";
const TT_USER_2 = "zaytosbsss";
const DC_INVITE = "z2s5AU94Qr";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9"
};

const get = (url, opts = {}) => fetch(url, { headers, signal: AbortSignal.timeout(7000), ...opts });

const parseShort = text => {
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*([KMB]?)/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
};

function findSubs(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const v = findSubs(item);
      if (v) return v;
    }
    return null;
  }
  const label = String(node.value ?? node.name ?? node.id ?? "").toLowerCase();
  if (/sub/.test(label) && Number(node.count) > 0) return Number(node.count);
  for (const key of ["est_sub", "estimatedSubscriberCount", "subscriberCount", "subscribers"]) {
    if (Number(node[key]) > 0) return Number(node[key]);
  }
  for (const value of Object.values(node)) {
    const v = findSubs(value);
    if (v) return v;
  }
  return null;
}

async function youtubeEstimate() {
  const r = await get(`https://mixerno.space/api/youtube-channel-counter/user/${YT_CHANNEL}`);
  if (!r.ok) return null;
  return findSubs(await r.json());
}

async function youtube() {
  const out = {};
  const key = Netlify.env.get("YT_API_KEY");

  if (key) {
    const r = await get(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${YT_CHANNEL}&key=${key}`);
    const s = (await r.json()).items?.[0]?.statistics;
    if (s) {
      out.subscribers = Number(s.subscriberCount);
      out.videos = Number(s.videoCount);
      out.views = Number(s.viewCount);
    }
  }

  if (!out.subscribers) {
    const html = await (await get(`https://www.youtube.com/channel/${YT_CHANNEL}?hl=en&gl=US`)).text();
    const m = html.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/) || html.match(/([\d.,]+[KMB]?) subscribers/);
    if (m) out.subscribers = parseShort(m[1]);
  }

  const estimate = await youtubeEstimate().catch(() => null);
  if (estimate && (!out.subscribers || Math.abs(estimate - out.subscribers) < out.subscribers * 0.05)) {
    out.official = out.subscribers;
    out.subscribers = estimate;
    out.estimated = true;
  }

  const feed = await (await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`)).text();
  const clean = t => t?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  out.recent = feed.split("<entry>").slice(1, 4).map(entry => ({
    id: entry.match(/<yt:videoId>([^<]+)/)?.[1],
    title: clean(entry.match(/<title>([^<]+)/)?.[1]),
    published: entry.match(/<published>([^<]+)/)?.[1]
  })).filter(v => v.id);
  out.latest = out.recent[0];

  const live = await (await get(`https://www.youtube.com/channel/${YT_CHANNEL}/live?hl=en`)).text();
  if (/"isLiveNow":true/.test(live)) {
    const id = live.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]+)"/)?.[1];
    out.live = true;
    if (id) out.liveUrl = `https://www.youtube.com/watch?v=${id}`;
  }

  return out;
}

async function tiktok(user) {
  const html = await (await get(`https://www.tiktok.com/@${user}?lang=en`)).text();
  const n = key => {
    const exact = html.match(new RegExp(`"${key}":"(\\d+)"`));
    const rounded = html.match(new RegExp(`"${key}":(\\d+)`));
    const m = exact || rounded;
    return m ? Number(m[1]) : undefined;
  };
  return {
    followers: n("followerCount"),
    likes: n("heartCount") ?? n("heart"),
    videos: n("videoCount"),
    live: /"roomId":"\d+"/.test(html)
  };
}

async function discord() {
  const r = await get(`https://discord.com/api/v10/invites/${DC_INVITE}?with_counts=true`);
  const d = await r.json();
  return { members: d.approximate_member_count, online: d.approximate_presence_count };
}

export default async () => {
  const [yt, tt, tt2, dc] = await Promise.allSettled([youtube(), tiktok(TT_USER), tiktok(TT_USER_2), discord()]);
  const body = {
    updated: new Date().toISOString(),
    youtube: yt.value ?? null,
    tiktok: tt.value ?? null,
    tiktok2: tt2.value ?? null,
    discord: dc.value ?? null
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
    }
  });
};

export const config = { path: "/api/stats" };
