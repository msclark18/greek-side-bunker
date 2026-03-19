// api/keep-alive.js
// Vercel cron job — runs daily to prevent Supabase free tier from pausing
// Scheduled in vercel.json

export default async function handler(req, res) {
  // Only allow GET (cron jobs use GET)
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Simple lightweight query — just count leagues, returns almost instantly
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/leagues?select=id&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error("Keep-alive ping failed:", response.status);
      return res.status(500).json({ ok: false, status: response.status });
    }

    console.log("Keep-alive ping successful:", new Date().toISOString());
    return res.status(200).json({ ok: true, timestamp: new Date().toISOString() });

  } catch (e) {
    console.error("Keep-alive error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
