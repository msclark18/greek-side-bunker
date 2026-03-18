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
    `${process.env.SUPABASE_URL}/rest/v1/rounds?attest_token=eq.${token}&select=id,player_name,course_name,gross,net,attest_status`,
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
      }),
    }
  );

  if (!updateRes.ok) {
    return res.status(500).send(errorPage("Something went wrong updating the round. Please try again or use the app."));
  }

  const appUrl = process.env.APP_URL ?? "";
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
