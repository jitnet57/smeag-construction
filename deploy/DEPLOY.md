# BRIGHTEM Payroll — Vercel Deploy Guide

This `deploy/` folder is a **ready-to-ship static site**. The Supabase URL and
anon key are already baked into the JavaScript bundle, so no environment
variables need to be configured on Vercel. Just upload this folder.

## What's inside
- `index.html` — app entry (mobile viewport enabled)
- `assets/` — compiled JS + CSS (Supabase + payroll engine run in the browser)
- `vercel.json` — SPA rewrite rules (`cleanUrls` + fallback to `index.html`)

## Backend
- **Supabase project:** `brightem-payroll` (`igpninthqdhqkuwwtngw`), region ap-southeast-1
- Data source: `VITE_USE_SUPABASE=1` — the app reads crews, employees, pay
  periods, attendance, deductions & config straight from Supabase and runs the
  pure `@brightem/engine` payroll calc client-side.

## Deploy with the Vercel CLI

```bash
# 1. Install the CLI (once)
npm i -g vercel

# 2. From this deploy/ folder, log in and deploy
cd deploy
vercel login
vercel deploy --prod
```

When Vercel asks:
- "Set up and deploy?" → **Y**
- "Which scope?" → your account/team
- "Link to existing project?" → **N** (first time)
- "Project name?" → e.g. `brightem-payroll`
- "In which directory is your code located?" → **./** (you're already inside `deploy/`)
- Build/Output settings → **accept defaults** (this is a pre-built static site;
  no build step is needed)

That's it — Vercel returns a live URL.

## Alternative: drag-and-drop
On https://vercel.com → "Add New… → Project" you can also drag this whole
`deploy/` folder into the dashboard. No build command, output dir = root.

## Rebuilding later
If employees/rates/UI change, rebuild from the monorepo root:

```bash
cd apps/web
VITE_USE_SUPABASE=1 \
VITE_SUPABASE_URL="https://igpninthqdhqkuwwtngw.supabase.co" \
VITE_SUPABASE_ANON_KEY="<anon key>" \
npx vite build
# then copy apps/web/dist/* over deploy/ (keep vercel.json)
```

## ⚠️ Security note (before real production)
Row Level Security (RLS) is currently **OFF** and the anon key ships in the
frontend (this is normal for Supabase anon keys, but with RLS off anyone with
the key can read/write). Before going fully live, enable RLS on the tables and
add auth/policies so the public key can't modify payroll data.
