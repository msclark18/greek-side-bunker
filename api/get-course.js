// api/get-course.js
// Vercel serverless function — fetches full course details (including hole data)
// from GolfCourseAPI by course ID. Server-side only so the API key stays hidden.
// GET /api/get-course?id=12345

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });

  if (!process.env.GOLF_COURSE_API_KEY) {
    return res.status(500).json({ error: "Golf course API key not configured" });
  }

  try {
    const resp = await fetch(
      `https://api.golfcourseapi.com/v1/courses/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Key ${process.env.GOLF_COURSE_API_KEY}` } }
    );
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ error: data.error ?? "Not found" });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message ?? "Unknown error" });
  }
}
