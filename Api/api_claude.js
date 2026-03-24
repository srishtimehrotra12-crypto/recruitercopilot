/**
 * RecruiterCopilot — Anthropic API Proxy
 * ─────────────────────────────────────────────────────────────────────────────
 * This tiny serverless function is the ONLY place the API key lives.
 * It is a Vercel Edge Function — runs on Vercel's servers, never in the browser.
 *
 * The frontend calls POST /api/claude with the request body.
 * This function adds the secret API key and forwards to Anthropic.
 * Users never see the key. It never appears in browser DevTools.
 *
 * RATE LIMITING (optional, add later):
 *   - You can add per-IP limits here if needed
 *   - e.g. max 20 calls/hour per IP using Vercel KV store
 */

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS — allow your own domain (update after deploying)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // API key is stored as a Vercel environment variable — never in code
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "API key not configured. Add ANTHROPIC_API_KEY in Vercel dashboard → Settings → Environment Variables.",
    });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // Forward Anthropic's status code and response
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy error: " + err.message });
  }
}
