// api/parse-scorecard-course.js
// Vercel serverless function — extracts golf course data from a scorecard image
// using Claude Vision, then saves to Supabase course_cache.
// POST /api/parse-scorecard-course
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageData, mediaType } = req.body;

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
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageData },
            },
            {
              type: "text",
              text: `Extract golf course data from this scorecard image and return ONLY a valid JSON object with this exact structure (no markdown, no explanation):

{
  "club_name": "Full club name",
  "course_name": "Course name (same as club_name if not specified separately)",
  "tees": [
    {
      "tee_name": "Black",
      "par_total": 72,
      "number_of_holes": 18,
      "slope_rating": 132,
      "course_rating": 74.2
    }
  ]
}

Rules:
- Include every tee box listed on the scorecard
- slope_rating is an integer (e.g. 132), course_rating is a decimal (e.g. 74.2)
- If a value is not visible on the card, use null
- number_of_holes is typically 18 or 9
- Return only the raw JSON, nothing else`,
            },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("Anthropic error:", err);
      return res.status(500).json({ error: "Failed to scan scorecard" });
    }

    const data = await resp.json();
    const text = data.content?.find(b => b.type === "text")?.text ?? "";
    const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/m, "").trim();

    let course;
    try {
      course = JSON.parse(cleaned);
    } catch {
      return res.status(422).json({ error: "Could not parse scorecard. Try a clearer photo." });
    }

    if (!course.club_name || !Array.isArray(course.tees) || course.tees.length === 0) {
      return res.status(422).json({ error: "No course data found. Try a clearer photo." });
    }

    // Save to course_cache (negative timestamp as sentinel api_id to avoid collisions)
    const sentinelId = -(Date.now() % 2_000_000_000);
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/course_cache`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.SUPABASE_SERVICE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          "Prefer": "resolution=ignore-duplicates",
        },
        body: JSON.stringify({
          api_id: sentinelId,
          club_name: course.club_name,
          course_name: course.course_name ?? course.club_name,
          location: null,
          tees: {
            male: course.tees.map(t => ({
              tee_name: t.tee_name,
              par_total: t.par_total,
              number_of_holes: t.number_of_holes ?? 18,
              slope_rating: t.slope_rating,
              course_rating: t.course_rating,
              total_yards: null,
              holes: [],
            })),
            female: [],
          },
        }),
      }
    );

    return res.status(200).json({ course });

  } catch (e) {
    console.error("parse-scorecard-course error:", e);
    return res.status(500).json({ error: e.message ?? "Unknown error" });
  }
}
