/**
 * RecruiterCopilot — Google Gemini API Proxy
 * ─────────────────────────────────────────────────────────────────────
 * Uses Google Gemini 1.5 Flash — COMPLETELY FREE
 *
 * Free tier limits (more than enough):
 *   - 15 requests per minute
 *   - 1 million tokens per day
 *   - No credit card required
 *   - Never expires
 *
 * Get your free API key at: aistudio.google.com
 * Click "Get API Key" → Create API key → Copy it
 * Add it in Vercel: Settings → Environment Variables → GEMINI_API_KEY
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Gemini API key not set. Add GEMINI_API_KEY in Vercel → Settings → Environment Variables. Get free key at aistudio.google.com"
    });
  }

  const { prompt, maxTokens = 1600 } = req.body;
  if (!prompt) return res.status(400).json({ error: "No prompt provided" });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0.3,   // Lower = more consistent JSON output
            topP: 0.8,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
        }),
      }
    );

    if (response.status === 429) {
      return res.status(429).json({ error: "Rate limit hit. Please wait 30 seconds and try again." });
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Gemini error:", err);
      return res.status(response.status).json({ error: err?.error?.message || "Gemini API error" });
    }

    const data = await response.json();

    // Extract text from Gemini response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({ error: "Empty response from Gemini" });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Proxy error: " + err.message });
  }
}
