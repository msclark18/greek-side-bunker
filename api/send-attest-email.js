// api/send-attest-email.js
// Vercel serverless function — replaces the Supabase Edge Function
// Called from the app when a player submits a round
//
// Required env vars (set in Vercel dashboard):
//   RESEND_API_KEY   — from resend.com
//   FROM_EMAIL       — e.g. noreply@yourdomain.com (must be verified in Resend)
//   SUPABASE_URL     — your Supabase project URL
//   SUPABASE_SERVICE_KEY — service role key (not anon key)

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    attesterEmail,
    attesterName,
    playerName,
    courseName,
    gross,
    net,
    par,
    date,
    leagueName,
    roundId,
    appUrl,
    ccEmails,
  } = req.body;

  if (!attesterEmail || !playerName || !roundId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Generate a secure attest token and save it to the round
  const token = crypto.randomUUID();

  // Update the round with the token via Supabase REST API
  const updateRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/rounds?id=eq.${roundId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ attest_token: token }),
    }
  );

  if (!updateRes.ok) {
    console.error("Failed to save attest token:", await updateRes.text());
    return res.status(500).json({ error: "Failed to save attest token" });
  }

  const approveUrl = `${appUrl}/api/attest-token?token=${token}&action=approved`;
  const rejectUrl = `${appUrl}/api/attest-token?token=${token}&action=rejected`;

  const netDisplay = net < par ? `${net} (${net - par})` : net === par ? `${net} (E)` : `${net} (+${net - par})`;

  // Send email via Resend
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to: attesterEmail,
      subject: `⛳ Attest ${playerName}'s round at ${courseName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attest Round</title>
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Georgia',serif;color:#f0ead8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <img src="https://ngesupnegqzoytucipii.supabase.co/storage/v1/object/public/assets/icon-512.png" width="64" height="64" alt="Greek Side Bunker" style="border-radius:50%;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" />
      <div style="font-family:'Georgia',serif;font-size:1.3rem;letter-spacing:3px;color:#faf9f6;font-weight:700;">GREEK SIDE BUNKER</div>
      <div style="font-size:.8rem;color:#c8bfa8;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">${leagueName}</div>
    </div>

    <!-- Main card -->
    <div style="background:#161d2e;border:1px solid rgba(212,168,67,0.3);border-radius:12px;padding:28px;margin-bottom:20px;">
      <div style="font-size:.7rem;letter-spacing:2px;text-transform:uppercase;color:#d4a843;font-family:Georgia,serif;margin-bottom:6px;">Attestation Request</div>
      <div style="font-size:1.1rem;color:#faf9f6;margin-bottom:20px;">
        Hi <strong>${attesterName}</strong>, <strong>${playerName}</strong> has listed you as their playing partner and needs you to attest their round.
      </div>

      <!-- Score details -->
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px;margin-bottom:20px;">
        <div style="margin-bottom:14px;">
          <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Date</div>
          <div style="font-size:1rem;color:#faf9f6;margin-top:2px;">${date}</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Course</div>
          <div style="font-size:1rem;color:#faf9f6;margin-top:2px;">${courseName}</div>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Gross</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#faf9f6;font-weight:700;">${gross}</div>
          </div>
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Net</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#f0c96a;font-weight:700;">${netDisplay}</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Par</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#c8bfa8;font-weight:700;">${par}</div>
          </div>
        </div>
      </div>

      <!-- Action buttons -->
      <div style="font-size:.82rem;color:#c8bfa8;margin-bottom:16px;">Did you play with ${playerName} and confirm this score is accurate?</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <a href="${approveUrl}" style="display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#d4a843,#f0c96a);color:#0a0e1a;text-decoration:none;border-radius:8px;font-family:Georgia,serif;font-size:.85rem;font-weight:700;letter-spacing:1px;">✓ Approve Round</a>
        <a href="${rejectUrl}" style="display:inline-block;padding:13px 28px;background:rgba(224,92,92,0.15);color:#f09090;text-decoration:none;border-radius:8px;font-family:Georgia,serif;font-size:.85rem;border:1px solid rgba(224,92,92,0.3);letter-spacing:1px;">✗ Reject</a>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:.72rem;color:#4b5563;line-height:1.6;">
      <p>You received this because ${playerName} listed you as their playing partner in ${leagueName}.</p>
      <p>You can also <a href="${appUrl}" style="color:#d4a843;">log in to the app</a> to attest rounds from the Attest tab.</p>
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

  // Send CC-only email (no action buttons) to commissioners
  if (ccEmails && ccEmails.length > 0) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL,
        to: ccEmails,
        subject: `👀 [CC] ${playerName}'s round at ${courseName}`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Georgia',serif;color:#f0ead8;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:32px;">
      <img src="${process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') + '/icon-512.png' : ''}" width="64" height="64" alt="Greek Side Bunker" style="border-radius:50%;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" />
      <div style="font-family:'Georgia',serif;font-size:1.1rem;letter-spacing:3px;color:#faf9f6;font-weight:700;">GREEK SIDE BUNKER</div>
      <div style="font-size:.7rem;color:#c8bfa8;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">${leagueName}</div>
    </div>
    <div style="background:#161d2e;border:1px solid rgba(212,168,67,0.3);border-radius:12px;padding:28px;margin-bottom:20px;">
      <div style="font-size:.7rem;letter-spacing:2px;text-transform:uppercase;color:#d4a843;margin-bottom:6px;">Round Submitted — FYI</div>
      <div style="font-size:1rem;color:#faf9f6;margin-bottom:20px;">
        <strong>${playerName}</strong> submitted a round at <strong>${courseName}</strong> and listed <strong>${attesterName}</strong> as their playing partner.
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:16px;margin-bottom:16px;">
        <div style="margin-bottom:14px;">
          <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Date</div>
          <div style="font-size:1rem;color:#faf9f6;margin-top:2px;">${date}</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-size:.62rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Course</div>
          <div style="font-size:1rem;color:#faf9f6;margin-top:2px;">${courseName}</div>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;">
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Gross</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#faf9f6;font-weight:700;">${gross}</div>
          </div>
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Net</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#f0c96a;font-weight:700;">${netDisplay}</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px 20px;">
            <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Par</div>
            <div style="font-size:1.8rem;font-family:Georgia,serif;color:#c8bfa8;font-weight:700;">${par}</div>
          </div>
        </div>
      </div>
      <div style="font-size:.82rem;color:#c8bfa8;">You are receiving this as a commissioner CC. Only ${attesterName} can approve or reject this round.</div>
    </div>
    <div style="text-align:center;font-size:.72rem;color:#4b5563;line-height:1.6;">
      <p>You can manage all rounds from the <a href="${appUrl}" style="color:#d4a843;">league app</a>.</p>
    </div>
  </div>
</body>
</html>
        `,
      }),
    });
  }

  return res.status(200).json({ ok: true });
}
