// api/attest-token.js
// Vercel serverless function — handles approve/reject links clicked from email
// GET /api/attest-token?token=xxx&action=approved|rejected
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   APP_URL — e.g. https://your-app.vercel.app (for redirect after action)

export default async function handler(req, res) {
  const { token, action } = req.query;

  if (!token || !["approved", "rejected"].includes(action)) {
    return res.status(400).send(errorPage("Invalid link — missing token or action."));
  }

  // Look up the round by token
  const lookupRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/rounds?attest_token=eq.${token}&select=id,player_id,player_name,course_name,gross,net,par,date,attest_status`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  const rounds = await lookupRes.json();

  if (!rounds || rounds.length === 0) {
    return res.status(404).send(errorPage("Round not found — this link may have already been used or is invalid."));
  }

  const round = rounds[0];

  // Already actioned?
  if (round.attest_status !== "pending") {
    return res.status(200).send(alreadyActioned(round));
  }

  // Update the round
  const updateRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/rounds?id=eq.${round.id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        attest_status: action,
        attest_at: new Date().toISOString(),
        attest_token: null,
      }),
    }
  );

  if (!updateRes.ok) {
    return res.status(500).send(errorPage("Something went wrong updating the round. Please try again or use the app."));
  }

  const appUrl = process.env.APP_URL ?? "";

  // Notify the player — non-blocking, never fail the request over this
  try {
    const profileRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${round.player_id}&select=email`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    const profiles = await profileRes.json();
    const playerEmail = profiles?.[0]?.email;
    if (playerEmail && process.env.RESEND_API_KEY) {
      const approved = action === "approved";
      const netDisplay = round.net < round.par ? `${round.net} (${round.net - round.par})` : round.net === round.par ? `${round.net} (E)` : `${round.net} (+${round.net - round.par})`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL,
          to: playerEmail,
          subject: approved ? `✅ Your round at ${round.course_name} was approved` : `❌ Your round at ${round.course_name} was rejected`,
          html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:Georgia,serif;color:#f0ead8;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="https://ngesupnegqzoytucipii.supabase.co/storage/v1/object/public/assets/icon-512.png" width="56" height="56" alt="GSB" style="border-radius:50%;display:block;margin:0 auto 8px;" />
      <div style="font-size:1.1rem;letter-spacing:3px;color:#faf9f6;font-weight:700;">GREEK SIDE BUNKER</div>
    </div>
    <div style="background:#161d2e;border:1px solid ${approved ? "rgba(76,175,125,0.35)" : "rgba(224,92,92,0.35)"};border-radius:12px;padding:28px;margin-bottom:20px;">
      <div style="font-size:2rem;text-align:center;margin-bottom:12px;">${approved ? "✅" : "❌"}</div>
      <div style="font-size:1.1rem;color:#faf9f6;margin-bottom:16px;text-align:center;">
        Your round was <strong style="color:${approved ? "#6ee7a0" : "#f09090"}">${approved ? "approved" : "rejected"}</strong>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:14px 16px;margin-bottom:${approved ? "0" : "16px"};">
        <div style="margin-bottom:10px;">
          <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Date</div>
          <div style="color:#faf9f6;margin-top:2px;">${round.date}</div>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-size:.6rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Course</div>
          <div style="color:#faf9f6;margin-top:2px;">${round.course_name}</div>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:8px 18px;">
            <div style="font-size:.58rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Gross</div>
            <div style="font-size:1.6rem;font-family:Georgia,serif;color:#faf9f6;font-weight:700;">${round.gross}</div>
          </div>
          <div style="text-align:center;background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.25);border-radius:8px;padding:8px 18px;">
            <div style="font-size:.58rem;letter-spacing:2px;text-transform:uppercase;color:#c8bfa8;">Net</div>
            <div style="font-size:1.6rem;font-family:Georgia,serif;color:#f0c96a;font-weight:700;">${netDisplay}</div>
          </div>
        </div>
      </div>
      ${!approved ? `<div style="font-size:.85rem;color:#c8bfa8;">You can resubmit your round from the app. If you have questions, contact your commissioner.</div>` : ""}
    </div>
    <div style="text-align:center;font-size:.72rem;color:#4b5563;">
      <a href="${appUrl}" style="color:#d4a843;">Open League App</a>
    </div>
  </div>
</body></html>`
        }),
      });
    }
  } catch (e) {
    console.warn("Player notification failed (non-fatal):", e);
  }

  return res.status(200).send(successPage(round, action, appUrl));
}

// ── HTML pages ──────────────────────────────────────────────────────────────

const shell = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Greek Side Bunker</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0e1a;color:#f0ead8;font-family:Georgia,serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
    .card{background:#161d2e;border:1px solid rgba(212,168,67,.3);border-radius:14px;padding:36px;max-width:440px;width:100%;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.5)}
    .logo{font-size:2.5rem;margin-bottom:12px}
    .brand{font-size:1rem;letter-spacing:3px;color:#faf9f6;font-weight:700;margin-bottom:24px}
    .icon{font-size:3rem;margin-bottom:16px}
    h1{font-size:1.1rem;color:#faf9f6;letter-spacing:1px;margin-bottom:10px}
    p{font-size:.9rem;color:#c8bfa8;line-height:1.6;margin-bottom:20px}
    .detail{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:.85rem;color:#c8bfa8;text-align:left}
    .detail strong{color:#faf9f6}
    a.btn{display:inline-block;padding:11px 24px;background:linear-gradient(135deg,#d4a843,#f0c96a);color:#0a0e1a;text-decoration:none;border-radius:8px;font-size:.8rem;font-weight:700;letter-spacing:1px}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⛳</div>
    <div class="brand">GREEK SIDE BUNKER</div>
    ${content}
  </div>
</body>
</html>
`;

const successPage = (round, action, appUrl) => shell(`
  <div class="icon">${action === "approved" ? "✅" : "❌"}</div>
  <h1>${action === "approved" ? "Round Approved!" : "Round Rejected"}</h1>
  <p>${action === "approved"
    ? `You've confirmed ${round.player_name}'s round. It will now count in the league standings.`
    : `You've rejected ${round.player_name}'s round. They'll be notified and can resubmit if needed.`
  }</p>
  <div class="detail">
    <strong>${round.player_name}</strong> · ${round.course_name}<br>
    Gross ${round.gross} · Net ${round.net}
  </div>
  ${appUrl ? `<a href="${appUrl}" class="btn">Open League App</a>` : ""}
`);

const alreadyActioned = (round) => shell(`
  <div class="icon">ℹ️</div>
  <h1>Already ${round.attest_status === "approved" ? "Approved" : "Actioned"}</h1>
  <p>This round has already been ${round.attest_status}. No further action needed.</p>
  <div class="detail">
    <strong>${round.player_name}</strong> · ${round.course_name}<br>
    Gross ${round.gross} · Net ${round.net}
  </div>
`);

const errorPage = (msg) => shell(`
  <div class="icon">⚠️</div>
  <h1>Something went wrong</h1>
  <p>${msg}</p>
`);
