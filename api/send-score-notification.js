// api/send-score-notification.js
// Vercel serverless function — notifies commissioners when a score is submitted.
// Fires for any submission regardless of attestation setting.
//
// Required env vars:
//   RESEND_API_KEY  — from resend.com
//   FROM_EMAIL      — verified sender address

const escapeHtml = (str) => {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])
  );
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    playerName,
    courseName,
    gross,
    net,
    par,
    date,
    leagueName,
    appUrl,
    commissionerEmails,
    stablefordPts,
    groupScores,
  } = req.body;

  if (!playerName || !commissionerEmails?.length) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "Email not configured" });
  }

  const safePlayer  = escapeHtml(playerName);
  const safeCourse  = escapeHtml(courseName);
  const safeLeague  = escapeHtml(leagueName);
  const safeDate    = escapeHtml(date);

  const netDisplay = (net != null && par != null)
    ? (net < par ? `${net} (${net - par})` : net === par ? `${net} (E)` : `${net} (+${net - par})`)
    : (net ?? "—");

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to: commissionerEmails,
      subject: Array.isArray(groupScores) && groupScores.length > 0
        ? `⛳ ${playerName} posted scores for a group at ${courseName}`
        : `⛳ ${playerName} posted a round at ${courseName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Score Posted</title>
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Georgia',serif;color:#f0ead8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <img src="https://ngesupnegqzoytucipii.supabase.co/storage/v1/object/public/assets/icon-512.png" width="64" height="64" alt="Greek Side Bunker" style="border-radius:50%;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" />
      <div style="font-family:'Georgia',serif;font-size:1.3rem;letter-spacing:3px;color:#faf9f6;font-weight:700;">GREEK SIDE BUNKER</div>
      <div style="font-size:.8rem;color:#c8bfa8;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">${safeLeague}</div>
    </div>

    <!-- Main card -->
    <div style="background:#161d2e;border:1px solid rgba(212,168,67,0.3);border-radius:12px;padding:28px;margin-bottom:20px;">
      <div style="font-size:.7rem;letter-spacing:2px;text-transform:uppercase;color:#d4a843;font-family:Georgia,serif;margin-bottom:6px;">Score Posted</div>
      <div style="font-size:1.1rem;color:#faf9f6;margin-bottom:20px;">
        <strong>${safePlayer}</strong> just submitted ${Array.isArray(groupScores) && groupScores.length > 0 ? `scores for a group of ${groupScores.length + 1}` : "a round"}.
      </div>

      <!-- Score details -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px;margin-bottom:20px;">
        <div style="margin-bottom:14px;">
          <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Date</div>
          <div style="font-size:1rem;color:#faf9f6;margin-top:2px;">${safeDate}</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Course</div>
          <div style="font-size:1rem;color:#faf9f6;margin-top:2px;">${safeCourse}</div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Gross</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#faf9f6;font-weight:700;">${gross ?? "—"}</div>
          </div>
          ${net != null ? `
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Net</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#f0c96a;font-weight:700;">${netDisplay}</div>
          </div>` : ""}
          ${par != null ? `
          <div style="text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Par</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#c8bfa8;font-weight:700;">${par}</div>
          </div>` : ""}
          ${stablefordPts != null ? `
          <div style="text-align:center;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Points</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#c4b5fd;font-weight:700;">${stablefordPts}</div>
          </div>` : ""}
        </div>
      </div>

      ${Array.isArray(groupScores) && groupScores.length > 0 ? `
      <!-- Group member scores -->
      <div style="margin-top:16px;margin-bottom:20px;">
        <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;margin-bottom:10px;">Group Scores — Submitted by ${escapeHtml(playerName)}</div>
        ${groupScores.map(gs => {
          const gsNetDisplay = (gs.net != null && par != null)
            ? (gs.net < par ? `${gs.net} (${gs.net - par})` : gs.net === par ? `${gs.net} (E)` : `${gs.net} (+${gs.net - par})`)
            : (gs.net ?? "—");
          return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;margin-bottom:8px;">
          <div style="font-size:.9rem;color:#faf9f6;font-weight:700;">${escapeHtml(gs.playerName)}</div>
          <div style="display:flex;gap:16px;">
            <div style="text-align:center;">
              <div style="font-size:.55rem;letter-spacing:1.5px;text-transform:uppercase;color:#c8bfa8;">Gross</div>
              <div style="font-size:1.1rem;font-family:Georgia,serif;color:#faf9f6;font-weight:700;">${gs.gross ?? "—"}</div>
            </div>
            ${gs.net != null ? `
            <div style="text-align:center;">
              <div style="font-size:.55rem;letter-spacing:1.5px;text-transform:uppercase;color:#c8bfa8;">Net</div>
              <div style="font-size:1.1rem;font-family:Georgia,serif;color:#f0c96a;font-weight:700;">${gsNetDisplay}</div>
            </div>` : ""}
            ${gs.courseHandicap != null ? `
            <div style="text-align:center;">
              <div style="font-size:.55rem;letter-spacing:1.5px;text-transform:uppercase;color:#c8bfa8;">Hcp</div>
              <div style="font-size:1.1rem;font-family:Georgia,serif;color:#c8bfa8;font-weight:700;">${gs.courseHandicap}</div>
            </div>` : ""}
          </div>
        </div>`;
        }).join("")}
      </div>` : ""}

      <a href="${appUrl}" style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#d4a843,#f0c96a);color:#0a0e1a;text-decoration:none;border-radius:8px;font-family:Georgia,serif;font-size:.85rem;font-weight:700;letter-spacing:1px;">View Leaderboard</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:.72rem;color:#4b5563;line-height:1.6;">
      <p>You received this because you are a commissioner of ${safeLeague} and score notifications are enabled.</p>
    </div>

  </div>
</body>
</html>
      `,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error("Resend score notification error:", err);
    return res.status(500).json({ error: "Failed to send notification", detail: err });
  }

  return res.status(200).json({ ok: true });
}
