# 🏌️ Greek Side Bunker — Deploy Guide

Google Auth + Multi-League + Email Attestation  
Stack: **Supabase + Vercel + Resend**  
Estimated setup time: **~25 minutes**

---

# STEP 1 — Supabase (Database + Auth)

1. Go to https://supabase.com → **New Project**

Project name:

```
greek-side-bunker
```

Choose a region and save your database password.

---

### Run the database schema

Go to:

```
SQL Editor → New Query
```

Paste the contents of:

```
supabase-schema.sql
```

Click **Run**.

You should see:

```
Success
```

---

### Enable Email Auth

Go to:

```
Authentication → Providers → Email
```

Turn **ON**

Optional (recommended for small leagues):

Disable:

```
Confirm email
```

This allows players to log in immediately without verifying email.

---

### Enable Google Auth

Go to:

```
Authentication → Providers → Google
```

Enable it.

You will need a Google OAuth client.

Go to:

https://console.cloud.google.com

Create:

```
APIs & Services → Credentials
Create Credentials → OAuth Client ID
Application type: Web Application
```

Add this redirect URI:

```
https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
```

Copy:

```
Client ID
Client Secret
```

Paste them back into **Supabase Google Auth settings**.

---

### Get API Keys

Go to:

```
Supabase → Settings → API
```

Copy:

```
Project URL
anon public key
```

You will use these in **Vercel**.

---

# STEP 2 — Resend (Email Sending)

Go to:

https://resend.com

Create a free account.

Free tier includes:

```
100 emails/day
```

---

### Add a domain

Go to:

```
Domains → Add Domain
```

Follow DNS instructions.

If you don't have a domain yet, you can use:

```
onboarding@resend.dev
```

for testing.

---

### Create API Key

Go to:

```
API Keys → Create API Key
```

Copy the key.

---

# STEP 3 — Deploy Edge Functions

Install the Supabase CLI:

```bash
npm install -g supabase
```

---

### Login

```bash
supabase login
```

---

### Link your project

```bash
supabase link --project-ref YOUR_PROJECT_ID
```

---

### Deploy Edge Functions

```bash
supabase functions deploy attest-score
supabase functions deploy attest-score-email
```

---

### Set Edge Function secrets

```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set APP_URL=https://your-app.vercel.app
supabase secrets set FROM_EMAIL=noreply@yourdomain.com
```

Note:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

are automatically available inside Edge Functions.

---

# STEP 4 — Push to GitHub

Create a repo:

https://github.com → **New Repository**

Name:

```
greek-side-bunker
```

---

From your project folder:

```bash
git init
git add .
git commit -m "Greek Side Bunker initial deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/greek-side-bunker.git
git push -u origin main
```

---

# STEP 5 — Vercel (Hosting)

Go to:

https://vercel.com

Click:

```
Add New Project
```

Import your GitHub repo.

---

### Add Environment Variables

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Values come from:

```
Supabase → Settings → API
```

---

### Deploy

Click **Deploy**

Your app will be live at something like:

```
https://greek-side-bunker.vercel.app
```

---

### Configure Supabase Auth URLs

Go to:

```
Supabase → Authentication → URL Configuration
```

Set:

```
Site URL
https://greek-side-bunker.vercel.app
```

Add redirect URL:

```
https://greek-side-bunker.vercel.app/**
```

---

### Update Edge Function APP_URL

Run again:

```bash
supabase secrets set APP_URL=https://greek-side-bunker.vercel.app
```

---

# STEP 6 — First Use

Open your app:

```
https://greek-side-bunker.vercel.app
```

---

### Setup flow

1. Sign in with Google  
2. Click **New League**  
3. Name your league  
4. Go to **Admin → League Settings**  
5. Copy the **Invite Code**  
6. Send it to your players

Players join with:

```
Login → Enter Invite Code → Join League
```

---

### Add Courses

Go to:

```
Admin → Courses
```

Add your golf courses.

---

### Configure Payouts

Go to:

```
Leaderboard → Payouts
```

---

# How Score Attestation Works

1. Player submits a round  
2. Selects playing partner as **attester**  
3. Edge function sends email to partner  
4. Partner clicks **Approve / Reject**  
5. Round status updates  
6. Only **approved rounds count toward leaderboard**

Players can also approve inside the app:

```
Post Score → Rounds Awaiting Attestation
```

---

# Free Tier Limits

Supabase

```
500MB database
1GB file storage
50k users
```

Vercel

```
100GB bandwidth
Unlimited deploys
```

Resend

```
100 emails/day
3000/month
```

More than enough for a golf league.

---

# Updating the App

Any code change:

```bash
git add .
git commit -m "update"
git push
```

Vercel redeploys automatically in ~30 seconds.

---

### Updating Edge Functions

```bash
supabase functions deploy attest-score
supabase functions deploy attest-score-email
```

---

# Project Structure (Recommended)

```
greek-side-bunker
│
├── src
├── supabase
│   └── functions
│       ├── attest-score
│       └── attest-score-email
│
├── supabase-schema.sql
├── .env
├── .gitignore
└── package.json
```