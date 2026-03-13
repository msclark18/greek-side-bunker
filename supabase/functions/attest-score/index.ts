// supabase/functions/attest-score/index.ts
// Handles GET requests from attester email links:
//   ?token=<uuid>&action=approved
//   ?token=<uuid>&action=rejected&note=<reason>
//
// Deploy with: supabase functions deploy attest-score

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!  // service role bypasses RLS
);

const APP_URL = Deno.env.get("APP_URL") ?? "https://your-app.vercel.app";

const html = (title: string, body: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · The Greek Side Bunker</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=EB+Garamond:ital,wght@0,400;1,400&display=swap');
    body{margin:0;background:#0a0e1a;color:#f0ead8;font-family:'EB Garamond',Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .box{background:#161d2e;border:1px solid rgba(212,168,67,0.3);border-radius:16px;padding:48px 40px;max-width:420px;width:100%;text-align:center;}
    .omega{font-size:3rem;background:linear-gradient(135deg,#d4a843,#f0c96a);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
    h1{font-family:'Cinzel',serif;font-size:1.4rem;color:#faf9f6;letter-spacing:2px;margin:12px 0 8px;}
    p{color:#c8bfa8;font-size:1.05rem;line-height:1.6;}
    .icon{font-size:3rem;margin:16px 0;}
    a{display:inline-block;margin-top:20px;padding:12px 28px;background:linear-gradient(135deg,#d4a843,#f0c96a);color:#0a0e1a;border-radius:8px;text-decoration:none;font-family:'Cinzel',serif;font-size:0.85rem;letter-spacing:1px;font-weight:700;}
  </style>
</head>
<body><div class="box">
  <div class="omega">Ω</div>
  <h1>THE GREEK SIDE BUNKER</h1>
  <div class="icon">${title === "Score Approved" ? "✅" : title === "Score Rejected" ? "❌" : "⚠️"}</div>
  <h1>${title}</h1>
  <p>${body}</p>
  <a href="${APP_URL}">Go to the App</a>
</div></body>
</html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");
  const note = url.searchParams.get("note") ?? "";

  if (!token || !["approved", "rejected"].includes(action ?? "")) {
    return new Response(html("Invalid Link", "This link is missing required parameters. Please contact your league admin."),
      { headers: { "content-type": "text/html" }, status: 400 });
  }

  // Look up round by token
  const { data: round, error } = await supabase
    .from("rounds")
    .select("id, attest_status, player_name, course_name, gross, net, par, date, league_id")
    .eq("attest_token", token)
    .single();

  if (error || !round) {
    return new Response(html("Link Not Found", "This attestation link is invalid or has already been used."),
      { headers: { "content-type": "text/html" }, status: 404 });
  }

  if (round.attest_status !== "pending") {
    const already = round.attest_status === "approved" ? "already approved ✅" : "already rejected ❌";
    return new Response(html("Already Actioned", `This score was ${already}. No further action needed.`),
      { headers: { "content-type": "text/html" } });
  }

  // Update the round
  const { error: updateErr } = await supabase
    .from("rounds")
    .update({
      attest_status: action,
      attest_note: note || null,
      attest_at: new Date().toISOString(),
    })
    .eq("id", round.id);

  if (updateErr) {
    return new Response(html("Error", "Something went wrong updating the score. Please try again or contact your league admin."),
      { headers: { "content-type": "text/html" }, status: 500 });
  }

  if (action === "approved") {
    return new Response(
      html("Score Approved", `You've confirmed <strong>${round.player_name}</strong>'s round at <strong>${round.course_name}</strong> on ${round.date} — Gross ${round.gross}, Net ${round.net}. Thanks for keeping the league honest!`),
      { headers: { "content-type": "text/html" } }
    );
  } else {
    return new Response(
      html("Score Rejected", `You've rejected <strong>${round.player_name}</strong>'s round at <strong>${round.course_name}</strong>. ${note ? `Reason: "${note}"` : ""} They'll be notified to resubmit.`),
      { headers: { "content-type": "text/html" } }
    );
  }
});
