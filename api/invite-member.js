// api/invite-member.js
// Vercel serverless function — sends a league invite email
// The league_invites row is already created client-side before this is called.
// POST /api/invite-member
//
// Required env vars:
//   RESEND_API_KEY
//   FROM_EMAIL
//   APP_URL — public app URL, e.g. https://greeksidebunker.com

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { leagueId, leagueName, email, name, invitedBy } = req.body;

  if (!leagueId || !email || !name) {
    return res.status(400).json({ error: "leagueId, email, and name are required" });
  }

  const normalEmail = email.trim().toLowerCase();

  // Send invite email via Resend
  const appUrl = process.env.APP_URL ?? process.env.VITE_APP_URL ?? "https://greeksidebunker.com";

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    process.env.FROM_EMAIL,
      to:      normalEmail,
      subject: `You've been invited to join ${leagueName} on Greek Side Bunker`,
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
      <img src="https://ngesupnegqzoytucipii.supabase.co/storage/v1/object/public/assets/icon-512.png"
           width="64" height="64" alt="Greek Side Bunker"
           style="border-radius:50%;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" />
      <div style="font-size:1.1rem;letter-spacing:3px;color:#faf9f6;font-weight:700;">GREEK SIDE BUNKER</div>
    </div>

    <div style="background:#161d2e;border:1px solid rgba(212,168,67,0.3);border-radius:12px;padding:28px;margin-bottom:16px;">
      <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#d4a843;margin-bottom:10px;">League Invitation</div>
      <p style="font-size:1.05rem;font-weight:700;color:#faf9f6;margin:0 0 12px;">Hey ${name}, you've been invited!</p>
      <p style="font-size:.9rem;color:#c8bfa8;line-height:1.7;margin:0 0 20px;">
        ${invitedBy ? `<strong style="color:#faf9f6">${invitedBy}</strong> has invited you` : "You've been invited"} to join
        <strong style="color:#d4a843">${leagueName}</strong> on Greek Side Bunker — the golf league management app.
      </p>
      <div style="text-align:center;">
        <a href="${appUrl}" style="display:inline-block;background:#d4a843;color:#0a0e1a;font-weight:700;font-size:.9rem;padding:12px 28px;border-radius:8px;text-decoration:none;letter-spacing:1px;">
          Create Your Account
        </a>
      </div>
    </div>

    <div style="background:#161d2e;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:16px 20px;margin-bottom:16px;">
      <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">How it works</div>
      <ol style="font-size:.83rem;color:#c8bfa8;line-height:2;margin:0;padding-left:20px;">
        <li>Click the button above and sign up with <strong style="color:#faf9f6">${normalEmail}</strong></li>
        <li>You'll automatically be added to <strong style="color:#d4a843">${leagueName}</strong></li>
        <li>Start posting scores and competing!</li>
      </ol>
    </div>

    <div style="text-align:center;font-size:.7rem;color:#4b5563;line-height:1.6;">
      <p>This invite was sent via Greek Side Bunker. If you weren't expecting this, you can ignore it.</p>
    </div>

  </div>
</body>
</html>
      `,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error("Resend error sending invite:", err);
    // Invite row was already stored — return partial success
    return res.status(200).json({ ok: true, emailSent: false });
  }

  return res.status(200).json({ ok: true, emailSent: true });
}
