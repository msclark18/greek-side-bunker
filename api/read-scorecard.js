// api/read-scorecard.js
// Vercel serverless function — reads a golf scorecard image using Claude
// POST /api/read-scorecard
//
// Required env vars:
//   ANTHROPIC_API_KEY — from console.anthropic.com

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageData, mediaType, playerName } = req.body;

  if (!imageData || !mediaType) {
    return res.status(400).json({ error: "Missing imageData or mediaType" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Anthropic API key not configured" });
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageData }
            },
            {
              type: "text",
              text: `This is a golf scorecard${playerName ? ` for a round played by ${playerName}` : ''}. ${playerName ? `Find ${playerName}'s total gross score specifically — there may be multiple players on this card.` : 'Extract the total gross score.'} Also extract the date played and the name of the golf course. Respond ONLY with valid JSON like: {"gross": 84, "date": "2025-05-10", "course": "Pebble Beach Golf Links"}. If you cannot find a value clearly, use null for that field. Do not include any other text.`
            }
          ]
        }]
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("Anthropic error:", err);
      return res.status(500).json({ error: "Failed to read scorecard" });
    }

    const data = await resp.json();
    const text = data.content?.find(b => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return res.status(200).json(parsed);

  } catch (e) {
    console.error("Scorecard read error:", e);
    return res.status(500).json({ gross: null, date: null });
  }
}
