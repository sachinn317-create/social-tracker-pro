// Vercel serverless function: /api/analyze
// Holds your Anthropic API key securely (server-side env var) and asks Claude
// to analyse a project's posts and return a social strategy report.

const MODEL = "claude-sonnet-4-6"; // swap to "claude-opus-4-8" for deeper analysis, or "claude-haiku-4-5-20251001" for cheaper/faster

const INDUSTRY_CONTEXT = {
  Hotel: "A hotel/hospitality brand. The audience is buying an experience and a feeling, sight unseen. The strategic job of content is to drive DIRECT bookings (away from OTAs/Airbnb), sell the experience over the room, and build desire and trust before arrival. Saves and shares signal 'I want to go here'.",
  Dental: "A dental practice. Patients are nervous and researching high-value treatments (implants, Invisalign, cosmetic) for weeks before booking. Content's job is to reduce fear, build trust and authority, and make patients feel comfortable before they ever enter. Educational and human content outperforms trends.",
  Aesthetics: "An aesthetic/cosmetic clinic. Clients are trusting the brand with their face, safety and confidence. Content must signal premium positioning, expertise and safety, attract high-value clients (not bargain-hunters) and stay within advertising compliance. Perception sets the price.",
  Restaurant: "A restaurant/hospitality venue. Content drives covers and bookings; food, atmosphere and craveable visuals matter; trends and local discovery play a bigger role than in high-consideration industries.",
  Other: "A brand using Instagram to grow awareness, trust and conversions. Judge what the data says without industry assumptions.",
};

// Best-effort per-IP rate limit. Note: serverless instances are ephemeral and
// distributed, so this caps casual abuse but is NOT a hard guarantee. For a
// firm cap, put Cloudflare AI Gateway in front, or use Upstash Redis (see README).
const RL = new Map();
function rateLimited(ip, max = 8, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const hits = (RL.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  RL.set(ip, hits);
  return hits.length > max;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // 1) Origin allowlist — only accept calls from your own site (optional).
  const allow = process.env.ALLOWED_ORIGIN;
  if (allow) {
    const src = req.headers.origin || req.headers.referer || "";
    if (!src.startsWith(allow)) {
      return res.status(403).json({ error: "Requests are only allowed from the approved site." });
    }
  }

  // 2) Access password — server-checked, so it actually protects credits (optional).
  const pass = process.env.APP_PASSWORD;
  if (pass) {
    const given = body.password || req.headers["x-app-password"] || "";
    if (given !== pass) {
      return res.status(401).json({ error: "Wrong or missing access password." });
    }
  }

  // 3) Rate limit per IP.
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many reports from this connection. Please wait a while and try again." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy." });
  }

  const { industry = "Other", projectName = "this brand", posts = [] } = body;
  if (!Array.isArray(posts) || posts.length < 2) {
    return res.status(400).json({ error: "Need at least 2 posts to analyse." });
  }

  const context = INDUSTRY_CONTEXT[industry] || INDUSTRY_CONTEXT.Other;

  const prompt = [
    `You are a senior social media strategist who works with premium ${industry.toLowerCase()} brands. You are analysing the Instagram performance of "${projectName}".`,
    ``,
    `INDUSTRY CONTEXT: ${context}`,
    ``,
    `Here is the performance data for ${posts.length} posts (engagement = (likes+comments+shares+saves)/reach as a %). Saves and shares are the strongest signals of reach and intent.`,
    ``,
    "```json",
    JSON.stringify(posts, null, 1),
    "```",
    ``,
    `Write a sharp, practical strategy report in British English, grounded ONLY in this data (cite specific posts, hashtags, audio, formats and numbers — do not invent metrics). Be honest about what is underperforming. Use this exact structure with markdown headings:`,
    ``,
    `## The headline`,
    `2–3 sentences: what this data is really telling us right now.`,
    ``,
    `## What's working`,
    `The specific posts, formats, hashtags, audio and caption patterns that are outperforming — and WHY they work for a ${industry.toLowerCase()} brand. Reference real numbers.`,
    ``,
    `## What's holding you back`,
    `The weakest patterns and the most likely reasons. Be direct but constructive.`,
    ``,
    `## Your next 30 days`,
    `A concrete plan: how many posts, the format mix, the themes to lean into, the best days to post based on the data, and what to stop doing.`,
    ``,
    `## 6 content ideas to film next`,
    `Six specific, ready-to-shoot ideas tailored to a ${industry.toLowerCase()} brand — each with a one-line hook/caption opener and the format (Reel/Carousel/etc.).`,
    ``,
    `## Hashtags & audio`,
    `Which tags/audio to keep using based on the data, and what to test next.`,
    ``,
    `Keep it tight and skimmable. No preamble, no sign-off — start at "## The headline".`,
  ].join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const detail = data?.error?.message || JSON.stringify(data).slice(0, 200);
      return res.status(r.status).json({ error: "Anthropic API: " + detail });
    }
    const report = (data.content || []).map((b) => b.text || "").join("").trim();
    return res.status(200).json({ report });
  } catch (e) {
    return res.status(502).json({ error: "Failed to reach Anthropic: " + (e.message || String(e)) });
  }
}
