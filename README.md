# Social Tracker Pro — Setup Guide

An AI-powered social media tracker with **separate projects per client**, full analytics, and an **AI Strategy** tab where Claude reads each client's numbers and writes a tailored report.

```
social-tracker-pro/
├── index.html        ← the app (front-end)
├── api/
│   └── analyze.js    ← secure backend that calls Claude (holds your API key)
├── package.json
└── README.md
```

## Why this one needs deploying (and the last one didn't)

The previous version was a single file you could drag-and-drop, but a single file **can't safely do AI** — your API key would be visible to anyone who viewed the page source. This version has a tiny backend (`api/analyze.js`) that keeps the key on the server and makes the Claude call for you. That's the whole reason it can suggest strategy instead of only charting numbers.

Everything *except* the AI tab still works offline. The AI tab needs the deployed version with your key.

---

## Part 1 — Get an Anthropic API key (~5 min)

The API is separate from your Claude.ai chat subscription — it's pay-as-you-go.

1. Go to **https://console.anthropic.com** and sign in.
2. Add a payment method and a little credit under **Billing** (even $5 covers a lot of reports).
3. Go to **API Keys → Create Key**, name it (e.g. "Social Tracker"), and **copy it**. You'll paste it in Part 2. Keep it private.

---

## Part 2 — Deploy to Vercel, no terminal (~10 min)

The simplest no-code route is GitHub → Vercel. You never touch a command line.

**A. Put the files on GitHub**
1. Create a free account at **https://github.com**.
2. Click **New repository** → name it `social-tracker-pro` → **Create**.
3. On the new repo page, click **uploading an existing file**, then drag in `index.html`, `package.json`, and the **`api` folder** (keep `analyze.js` inside `api/`). Commit.

**B. Deploy on Vercel**
1. Create a free account at **https://vercel.com** (sign in with GitHub — easiest).
2. **Add New → Project** → import your `social-tracker-pro` repo.
3. Framework Preset: **Other**. Leave build settings default.
4. Open **Environment Variables** and add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** *(paste the key from Part 1)*
5. Click **Deploy**.

Vercel gives you a permanent URL like `https://social-tracker-pro.vercel.app`. It stays live 24/7, free, no expiry. The AI tab now works.

> Changed the key or added it after deploying? Hit **Redeploy** once so it takes effect.

---

## Part 3 — Embed on your WordPress page

Edit the page → **Custom HTML** block → paste, swapping in your Vercel URL:

```html
<iframe src="https://YOUR-PROJECT.vercel.app/"
        title="Social Tracker" width="100%" height="1100"
        frameborder="0" style="border:0;"></iframe>
```

No "refused to connect" this time — it's your own domain doing the hosting.

---

## Part 4 — Protect your credits (important)

A public AI endpoint can be abused to burn your credits ("denial of wallet"). Defend it in layers, easiest first:

**1. Set a hard spend cap (do this first — your safety net).**
In **console.anthropic.com → Limits / Billing**, set a monthly spend limit. Even if everything else failed, billing stops at your cap. Use a dedicated API key for this app so you can revoke it instantly.

**2. Turn on the access password (built in).**
Add an environment variable in Vercel:
- **Name:** `APP_PASSWORD`  **Value:** a password you choose.

Now the AI tab only runs for people who type that password (there's a field on the AI card). The check happens on the server, so it genuinely protects credits — share the password only with your team/clients. Leave it unset and the tool stays open.

**3. Lock it to your own site (built in).**
Add an environment variable:
- **Name:** `ALLOWED_ORIGIN`  **Value:** `https://kanikasachdev.com` (or your Vercel URL)

The backend then refuses AI calls that don't come from your site.

**4. Rate limiting (built in, basic).**
The function already caps reports per visitor per hour. Because Vercel's servers are ephemeral, treat this as a deterrent, not a guarantee.

**5. The "AI firewall" you heard about — for when you scale.**
For a hard, reliable cap, route the Claude call through **Cloudflare AI Gateway** (free): it sits in front of the API and gives you rate limits, caching, spend analytics and per-key budgets. Alternatively, **Upstash Redis** (free tier) gives rock-solid per-IP/per-user limits in a few lines. Say the word and I'll wire either one in.

> After adding any environment variable, click **Redeploy** once so it takes effect.

---

## Costs

You're billed by Anthropic only when someone clicks **Generate report**. Each report is one short API call — typically a few pence on the default model (`claude-sonnet-4-6`). To change the model, edit the `MODEL` line at the top of `api/analyze.js`:
- `claude-opus-4-8` — deeper, pricier analysis
- `claude-haiku-4-5-20251001` — cheapest and fastest

---

## How the data works (read before clients use it)

- **Projects & posts** are saved in the browser (localStorage), **per device**. Each client's data lives in its own project. The **Export** button backs up any project to CSV.
- **AI reports** are cached per project so you don't re-pay to re-read them; hit *Regenerate* for a fresh one.
- **The current limit:** because storage is per-browser, your data doesn't sync between your laptop and phone, and clients can't log into their own accounts from anywhere. That's the line between this (a superb single-operator tool) and a true SaaS.

## The next step up — when you're ready to sell it

To make this a real multi-user product — client logins, data in the cloud synced across devices, you overseeing every client account from one dashboard — the upgrade is a database + auth layer (e.g. **Supabase**, which has a generous free tier) behind this same interface. The tracking, analytics and AI logic you have here all carry over. Say the word and I'll spec that build: schema, auth, and the changes to wire it in.
