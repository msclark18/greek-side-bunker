// api/search-courses.js
// Vercel serverless function — proxies GolfCourseAPI search so the API key
// stays server-side and is never exposed to the browser.
// GET /api/search-courses?q=pebble+beach

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { q } = req.query;
  if (!q?.trim()) return res.status(400).json({ error: "Missing query" });

  if (!process.env.GOLF_COURSE_API_KEY) {
    return res.status(500).json({ error: "Golf course API key not configured" });
  }

  try {
    const resp = await fetch(
      `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Key ${process.env.GOLF_COURSE_API_KEY}` } }
    );
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error ?? "Search failed" });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message ?? "Unknown error" });
  }
}
