// Vercel serverless function: /api/insights
// Generates a Story & Motion strategy report for one client, grounded in their
// real timeline + outcome data. The Anthropic key stays server-side.
//
// SECURITY: only a signed-in ADMIN can call this. The browser sends the user's
// Supabase access token in the Authorization header; we verify it and check
// their profile role = 'admin' before spending any API credits. Clients cannot.
//
// Required Vercel env vars:
//   ANTHROPIC_API_KEY   - your Anthropic key (already set)
//   SUPABASE_URL        - your project URL, e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY   - your anon public key (same one in index.html; safe)

const MODEL = "claude-sonnet-4-6"; // swap to "claude-opus-4-8" for deeper analysis

const INDUSTRY_CONTEXT = {
  Hotel: "A hotel/hospitality brand. The audience is buying an experience and a feeling, sight unseen. Content's strategic job is to drive DIRECT bookings (away from OTAs/Airbnb), sell the experience over the room, and build desire and trust before arrival. Saves and shares signal 'I want to go here'.",
  Dental: "A dental practice. Patients are nervous and research high-value treatments (implants, Invisalign, cosmetic) for weeks before booking. Content's job is to reduce fear, build trust and authority, and make patients feel comfortable before they ever walk in. Educational, human content beats trends.",
  Aesthetics: "An aesthetic/cosmetic clinic. Clients trust the brand with their face, safety and confidence. Content must signal premium positioning, expertise and safety, attract high-value clients (not bargain-hunters), and stay within advertising compliance. Perception sets the price.",
  Restaurant: "A restaurant/venue. Content drives covers and bookings; food, atmosphere and craveable visuals matter; local discovery and trends play a bigger role than in high-consideration industries.",
  Other: "A brand using Instagram to grow awareness, trust and conversions. Judge what the data says without industry assumptions.",
};

const RL = new Map();
function rateLimited(ip, max = 12, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const hits = (RL.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  RL.set(ip, hits);
  return hits.length > max;
}

async function verifyAdmin(token) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, code: 500, error: "Server is missing SUPABASE_URL / SUPABASE_ANON_KEY. Add them in Vercel and redeploy." };
  if (!token) return { ok: false, code: 401, error: "You're not signed in. Sign out and back in, then try again." };

  const u = await fetch(url + "/auth/v1/user", { headers: { apikey: anon, authorization: "Bearer " + token } });
  if (!u.ok) return { ok: false, code: 401, error: "Your session has expired. Sign out and back in." };
  const user = await u.json();

  const pr = await fetch(url + "/rest/v1/profiles?id=eq." + user.id + "&select=role", { headers: { apikey: anon, authorization: "Bearer " + token } });
  const rows = await pr.json();
  if (!Array.isArray(rows) || !rows[0] || rows[0].role !== "admin") {
    return { ok: false, code: 403, error: "Only the agency admin can generate reports." };
  }
  return { ok: true, user };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // 1) Only signed-in admins (token comes in the Authorization header).
  const authz = req.headers.authorization || "";
  const token = authz.replace(/^Bearer\s+/i, "").trim();
  const auth = await verifyAdmin(token);
  if (!auth.ok) return res.status(auth.code).json({ error: auth.error });

  // 2) Rate limit.
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return res.status(429).json({ error: "That's a lot of reports in a short time. Give it an hour and try again." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel. Add it, then redeploy." });

  const name = body.client_name || "this brand";
  const industry = body.client_industry || "Other";
  const period = body.period_label || "this period";
  const posts = Array.isArray(body.posts) ? body.posts : [];
  const readings = Array.isArray(body.account_readings) ? body.account_readings : [];
  const current = body.current || {};
  const previous = body.previous || {};

  if (posts.length < 1 && readings.length < 1) {
    return res.status(400).json({ error: "Not enough data in this period yet - log a few posts or readings first." });
  }

  const context = INDUSTRY_CONTEXT[industry] || INDUSTRY_CONTEXT.Other;

  const prompt = [
    `You are a senior strategist at Story & Motion, a premium UK video production and content studio. Your tagline is "We don't just film - we tell stories that matter." You are writing the monthly performance + strategy report for your client "${name}", covering ${period}.`,
    ``,
    `INDUSTRY CONTEXT: ${context}`,
    ``,
    `Engagement rate = (likes+comments+shares+saves)/reach as a %. Saves and shares are the strongest signals of intent and future reach.`,
    ``,
    `THIS PERIOD'S DATA vs the previous period (ground every claim in these numbers - never invent metrics):`,
    "```json",
    JSON.stringify({ period, current, previous, posts, account_readings: readings }, null, 1),
    "```",
    ``,
    `Write in confident, strategic, premium British English - the voice of a studio that leads with story, not vanity metrics. Be specific and honest, including about what underperformed. Reference real posts, formats, days/times and numbers. Speak as "we" (Story & Motion) addressing the client.`,
    ``,
    `Output GitHub-flavoured markdown using these EXACT section headings, with nothing before the first heading and no sign-off after the last:`,
    ``,
    `## The headline`,
    `2-3 sentences on what this period's data is really telling us.`,
    ``,
    `## What's working & why`,
    `4-6 bullet points. Each names the specific post/format/timing/number and explains WHY it works for a ${industry.toLowerCase()} brand.`,
    ``,
    `## What to change next month`,
    `4-6 bullet points: what to do more of, what to stop, the best days/formats based on the data. Be direct but constructive.`,
    ``,
    `## Next month's content calendar`,
    `Exactly 6 ideas as bullet points spread across four weeks. Format each as one bullet: **Week X - [Format]:** the concept. Hook: the first line / first 2 seconds. CTA: the call to action.`,
    ``,
    `Keep every line tight and skimmable. Start at "## The headline".`,
  ].join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 3200, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (!r.ok) {
      const detail = (data && data.error && data.error.message) || JSON.stringify(data).slice(0, 200);
      return res.status(r.status).json({ error: "Anthropic API: " + detail });
    }
    const report = (data.content || []).map((b) => b.text || "").join("").trim();
    if (!report) return res.status(502).json({ error: "The report came back empty. Please try generating again." });
    return res.status(200).json({ report });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach Anthropic: " + (e.message || String(e)) });
  }
}
