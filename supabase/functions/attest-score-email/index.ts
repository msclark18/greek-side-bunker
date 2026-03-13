// supabase/functions/attest-score-email/index.ts
// Sends the attestation email to the playing partner.
// Uses Resend (https://resend.com) — free tier: 100 emails/day, 3,000/month.
//
// Deploy: supabase functions deploy attest-score-email
// Set secret: supabase secrets set RESEND_API_KEY=re_xxxx
//             supabase secrets set APP_URL=https://your-app.vercel.app
//             supabase secrets set FROM_EMAIL=noreply@yourdomain.com

const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_URL    = Deno.env.get("APP_URL") ?? "https://your-app.vercel.app";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "noreply@thegreeksheet.com";
// The attest-score function URL (your Supabase project URL + function path)
const ATTEST_FN  = Deno.env.get("SUPABASE_URL") + "/functions/v1/attest-score";

Deno.serve(async (req) => {
  const {
    attesterEmail, attesterName, playerName,
    courseName, gross, net, par, date,
    leagueName, token, appUrl
  } = await req.json();

  const baseUrl = appUrl ?? APP_URL;
  const approveUrl = `${ATTEST_FN}?token=${token}&action=approved`;
  const rejectUrl  = `${ATTEST_FN}?token=${token}&action=rejected`;
  const diff = net - par;
  const pm   = diff === 0 ? "Even" : diff > 0 ? `+${diff}` : `${diff}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body{margin:0;padding:0;background:#f4f4f5;font-family:Georgia,serif}
  .wrap{max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .header{background:#0a0e1a;padding:32px;text-align:center}
  .omega{font-size:2.5rem;color:#d4a843;font-family:serif}
  .header h1{font-family:Georgia,serif;font-size:1.4rem;color:#faf9f6;letter-spacing:3px;margin:8px 0 4px}
  .header p{color:#c8bfa8;font-size:.9rem;font-style:italic;margin:0}
  .body{padding:32px}
  .body p{color:#2d2d2d;font-size:1rem;line-height:1.7;margin:0 0 16px}
  .score-box{background:#f9f7f2;border:1px solid #e5dcc8;border-radius:10px;padding:20px 24px;margin:20px 0}
  .score-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #ede9df;font-size:.95rem;color:#555}
  .score-row:last-child{border-bottom:none}
  .score-row strong{color:#1a1a1a}
  .actions{display:flex;gap:12px;margin:24px 0;flex-wrap:wrap}
  .btn-approve{flex:1;padding:14px;background:#1a6b3c;color:#fff;border:none;border-radius:8px;font-size:1rem;font-family:Georgia,serif;font-weight:bold;text-align:center;text-decoration:none;display:block}
  .btn-reject{flex:1;padding:14px;background:#fff;color:#c0392b;border:2px solid #c0392b;border-radius:8px;font-size:1rem;font-family:Georgia,serif;font-weight:bold;text-align:center;text-decoration:none;display:block}
  .footer{padding:20px 32px;background:#f9f7f2;text-align:center;font-size:.78rem;color:#999;font-style:italic}
  a.app-link{color:#d4a843}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="omega">Ω</div>
    <h1>THE GREEK SHEET</h1>
    <p>${leagueName ?? "Golf League"}</p>
  </div>
  <div class="body">
    <p>Hi ${attesterName},</p>
    <p><strong>${playerName}</strong> has submitted a round and listed you as their playing partner. Please review and attest their score:</p>
    <div class="score-box">
      <div class="score-row"><span>Course</span><strong>${courseName}</strong></div>
      <div class="score-row"><span>Date</span><strong>${date}</strong></div>
      <div class="score-row"><span>Gross Score</span><strong>${gross}</strong></div>
      <div class="score-row"><span>Net Score</span><strong>${net} (${pm})</strong></div>
    </div>
    <p>Did you play with ${playerName} and can confirm this score is accurate?</p>
    <div class="actions">
      <a href="${approveUrl}" class="btn-approve">✓ Yes, Approve Score</a>
      <a href="${rejectUrl}" class="btn-reject">✗ No, Reject Score</a>
    </div>
    <p style="font-size:.85rem;color:#888">Clicking Approve or Reject will take you to a confirmation page. Only approved rounds count on the leaderboard.</p>
  </div>
  <div class="footer">
    <a href="${baseUrl}" class="app-link">Open The Greek Sheet</a> &nbsp;·&nbsp; You're receiving this because you were listed as a playing partner.
  </div>
</div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: attesterEmail,
      subject: `⛳ Please attest ${playerName}'s round at ${courseName}`,
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ error: err }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
