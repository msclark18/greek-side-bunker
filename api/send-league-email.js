// api/send-league-email.js
// Vercel serverless function — sends a league-wide email from the commissioner
// POST /api/send-league-email
//
// Required env vars:
//   RESEND_API_KEY
//   FROM_EMAIL        — e.g. noreply@greeksidebunker.com
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

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

  // Verify the caller is an admin of the league
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const jwt = authHeader.slice(7);

  const { leagueId, leagueName, subject, message, senderName, recipients: explicitRecipients } = req.body;

  if (!leagueId || !subject || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Verify caller identity and admin role via Supabase
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!userRes.ok) {
    return res.status(401).json({ error: "Invalid session" });
  }
  const { id: callerId } = await userRes.json();

  const memberRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/league_members?league_id=eq.${leagueId}&user_id=eq.${callerId}&select=role`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  const membership = await memberRes.json();
  if (!membership?.[0] || membership[0].role !== "admin") {
    return res.status(403).json({ error: "Only league admins can send league emails" });
  }

  let recipients = explicitRecipients;

  // If no explicit recipients passed, fetch all members
  if (!recipients || recipients.length === 0) {
    const membersRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/league_members?league_id=eq.${leagueId}&select=user_id,profiles(name,email)`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const members = await membersRes.json();
    if (!members || members.length === 0) {
      return res.status(404).json({ error: "No members found" });
    }
    recipients = members.map(m => m.profiles?.email).filter(Boolean);
  }

  if (recipients.length === 0) {
    return res.status(404).json({ error: "No member emails found" });
  }

  // message is intentional HTML from the editor toolbar — escape metadata only
  const htmlMessage = message
    .split("\n")
    .map(line => line.trim() ? `<p style="margin:0 0 10px;font-size:.95rem;color:#f0ead8;line-height:1.7;">${line}</p>` : "<br/>")
    .join("");

  const safeLeagueName = escapeHtml(leagueName);
  const safeSubject    = escapeHtml(subject);
  const safeSenderName = escapeHtml(senderName);

  // Send via Resend — one email to all recipients using bcc
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to: process.env.FROM_EMAIL,
      bcc: recipients,
      subject: `⛳ ${safeLeagueName} — ${safeSubject}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Georgia',serif;color:#f0ead8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <div style="text-align:center;margin-bottom:28px;">
      <img src="https://ngesupnegqzoytucipii.supabase.co/storage/v1/object/public/assets/icon-512.png" width="64" height="64" alt="Greek Side Bunker" style="border-radius:50%;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" />
      <div style="font-size:1.1rem;letter-spacing:3px;color:#faf9f6;font-weight:700;">GREEK SIDE BUNKER</div>
      <div style="font-size:.7rem;color:#c8bfa8;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">${safeLeagueName}</div>
    </div>

    <div style="background:#161d2e;border:1px solid rgba(212,168,67,0.3);border-radius:12px;padding:24px;margin-bottom:16px;">
      <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#d4a843;margin-bottom:6px;">League Message</div>
      <div style="font-size:1rem;color:#faf9f6;font-weight:700;margin-bottom:16px;">${safeSubject}</div>
      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;">
        <style>a { color: #d4a843; }</style>
      ${htmlMessage}
      </div>
    </div>

    <div style="text-align:center;font-size:.7rem;color:#4b5563;line-height:1.6;">
      <p>This message was sent by ${safeSenderName || "your commissioner"} via ${safeLeagueName}.</p>
    </div>

  </div>
</body>
</html>
      `,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error("Resend error:", err);
    return res.status(500).json({ error: "Failed to send email", detail: err });
  }

  return res.status(200).json({ ok: true, sent: recipients.length });
}
