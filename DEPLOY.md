# 🏌️ The Greek Sheet v2 — Deploy Guide
# Google Auth + Multi-League + Email Attestation
# Free stack: Supabase + Vercel + Resend
# Total time: ~25 minutes

═══════════════════════════════════════════════
STEP 1 — Supabase (database + auth)
═══════════════════════════════════════════════

1. Go to https://supabase.com → New Project
   Name: greek-sheet-v2 · Pick your region · Save your DB password

2. SQL Editor → New Query → paste supabase-schema.sql → Run
   You should see "Success."

3. Enable Email Auth (for players without Google):
   - Authentication → Providers → Email → make sure it's ON
   - Optional: Toggle OFF "Confirm email" if you want players
     to sign in immediately without verifying their inbox
     (fine for a small trusted league, less secure generally)

4. Enable Google Auth (optional — players can use email instead):
   - Authentication → Providers → Google → Enable
   - You'll need a Google OAuth Client ID + Secret.
     Go to: https://console.cloud.google.com
     → New Project → APIs & Services → Credentials
     → Create Credentials → OAuth 2.0 Client ID
     → Application type: Web application
     → Authorized redirect URIs: add
       https://your-project-id.supabase.co/auth/v1/callback
     → Copy Client ID and Client Secret back into Supabase

4. Get your API keys:
   Settings → API → copy Project URL + anon public key


═══════════════════════════════════════════════
STEP 2 — Resend (email sending, free)
═══════════════════════════════════════════════

1. Go to https://resend.com → Sign up (free: 100 emails/day)

2. Add your domain (or use their test domain for dev):
   Domains → Add Domain → follow DNS instructions
   (If you don't have a domain yet, you can use
    onboarding@resend.dev as FROM_EMAIL for testing)

3. API Keys → Create API Key → copy it


═══════════════════════════════════════════════
STEP 3 — Deploy Edge Functions
═══════════════════════════════════════════════

Install the Supabase CLI if you haven't:
   npm install -g supabase

Log in and link your project:
   supabase login
   supabase link --project-ref your-project-id

Deploy both functions:
   supabase functions deploy attest-score
   supabase functions deploy attest-score-email

Set the required secrets:
   supabase secrets set RESEND_API_KEY=re_your_key_here
   supabase secrets set APP_URL=https://your-app.vercel.app
   supabase secrets set FROM_EMAIL=noreply@yourdomain.com

   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
    automatically available inside Edge Functions — no need
    to set those manually.)


═══════════════════════════════════════════════
STEP 4 — Push to GitHub
═══════════════════════════════════════════════

1. Create a new repo at https://github.com → New repository
   Name: greek-sheet-v2 · Private recommended

2. In your terminal from the project folder:
   git init
   git add .
   git commit -m "Greek Sheet v2"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/greek-sheet-v2.git
   git push -u origin main


═══════════════════════════════════════════════
STEP 5 — Vercel (hosting)
═══════════════════════════════════════════════

1. https://vercel.com → Add New Project → import your repo

2. Add Environment Variables:
   VITE_SUPABASE_URL        → your Supabase project URL
   VITE_SUPABASE_ANON_KEY   → your anon public key

3. Click Deploy → get your live URL
   e.g. https://greek-sheet-v2.vercel.app

4. Go back to Supabase → Authentication → URL Configuration:
   Site URL:             https://greek-sheet-v2.vercel.app
   Redirect URLs: add    https://greek-sheet-v2.vercel.app/**

5. Go back to Google Cloud Console → your OAuth client:
   Add to Authorized redirect URIs:
     https://your-project-id.supabase.co/auth/v1/callback
   (should already be there from Step 1, just double-check)

6. Re-run:
   supabase secrets set APP_URL=https://greek-sheet-v2.vercel.app
   (Now that you have your real Vercel URL)


═══════════════════════════════════════════════
STEP 6 — First use
═══════════════════════════════════════════════

1. Open your live URL → Sign in with Google
2. Click "+ New League" → give it a name
3. Go to ⚙ Admin → League Settings to get your invite code
4. Share the invite code with your players — they sign in
   with Google and enter the code to join
5. Admin → Courses to add your real courses
6. Set payouts under Leaderboard → 💰 Payouts


═══════════════════════════════════════════════
HOW ATTESTATION WORKS
═══════════════════════════════════════════════

1. Player submits a round, selects their playing partner
2. App calls the attest-score-email Edge Function
3. Partner receives an email with Approve / Reject buttons
4. Clicking either button hits the attest-score Edge Function
5. Round status updates to "approved" or "rejected"
6. Only approved rounds appear on the leaderboard
7. Partners can also approve/reject directly in the app
   under Post Score → "Rounds Awaiting Your Attestation"


═══════════════════════════════════════════════
FREE TIER LIMITS
═══════════════════════════════════════════════

Supabase Free:   500 MB DB · 1 GB file storage · 50k users
Vercel Free:     100 GB bandwidth · unlimited deploys
Resend Free:     100 emails/day · 3,000/month

All more than enough for a golf league.


═══════════════════════════════════════════════
FUTURE UPDATES
═══════════════════════════════════════════════

Any code change:
   git add . && git commit -m "update" && git push
   → Vercel redeploys automatically in ~30 seconds

Any function change:
   supabase functions deploy attest-score
   supabase functions deploy attest-score-email
