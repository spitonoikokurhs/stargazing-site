# Stargazing Events

The website behind [stargazing.events](https://stargazing.events) and
[stargazing.world](https://stargazing.world) — a Next.js site for stargazing
events, hosted on Vercel.

If you're future-me (or future-anyone) picking this up after a break: this file
is the map. Start here.

## What it is

A [Next.js 14](https://nextjs.org/docs) site using the **App Router**. It's
deployed on **Vercel** and served from two custom domains — `stargazing.events`
and `stargazing.world` — both pointing at the same deployment.

Right now it's a mostly-static marketing/content site (homepage, privacy page,
a Bodrum hotels landing page, plus generated `robots.txt` and `sitemap.xml`).
Phase 2 adds the live-view and event features, which is what the storage-related
environment variables below are for.

## Tech stack

- **Next.js 14** (App Router) + **React 18**
- **TypeScript** (strict mode)
- **Vercel Analytics** + **Speed Insights** for traffic and performance metrics
- **Cookie consent** banner gating **Google Analytics 4 (GA4)** — analytics
  scripts only load after the visitor consents

Styling is plain CSS (per-route `*.css` files plus `app/globals.css`), no CSS
framework.

## Prerequisites

- **Node 20.x or later** (20.20.2 confirmed working; Node 22.x should be fine
  too). On Windows, install and pin it with
  [nvm-windows](https://github.com/coreybutler/nvm-windows):
  ```
  nvm install 20.20.2   # or any Node 20.x version
  nvm use 20.20.2
  ```
- **npm** (ships with Node)

## Running locally

```bash
git clone https://github.com/spitonoikokurhs/stargazing-site.git
cd stargazing-site
npm install
npm run dev
```

The dev server runs on **port 3350** → http://localhost:3350

Other scripts:

- `npm run build` — production build
- `npm start` — serve the production build (also on port 3350)
- `npm run lint` — ESLint (`next/core-web-vitals`)

## Project structure

```
app/                      # Next.js App Router — routes, layouts, styles
  layout.tsx              # Root layout: analytics, speed insights, cookie consent
  page.tsx                # Homepage
  globals.css             # Global styles
  privacy/                # Privacy policy page
  bodrum-hotelleri/       # Bodrum hotels landing page
  robots.ts               # Generates /robots.txt
  sitemap.ts              # Generates /sitemap.xml
public/                   # Static assets served as-is
  images/                 # Astrophotography, logos, favicons
  homepage-scripts.js     # Client-side homepage behavior
next.config.js            # Next.js config
tsconfig.json             # TypeScript config (strict, @/* path alias)
.eslintrc.json            # ESLint config
package.json              # Scripts and dependencies
```

## Deployment

Deployment is handled by **Vercel**, wired to this GitHub repo:

- Push to **`main`** → auto-deploys to production (`stargazing.events` /
  `stargazing.world`)
- To roll back: in the Vercel dashboard → Deployments → find the last known good
  deployment → ⋯ menu → Promote to Production. Rollback is ~5 seconds.
- Push to **any other branch** → Vercel builds a **preview deployment** with its
  own URL

No manual deploy step — pushing is deploying.

## Environment variables

Local and production configuration lives in environment variables. See
[`.env.example`](./.env.example) for the full list of what's required, grouped
by service (Vercel Blob, Upstash Redis, Neon Postgres, and app secrets).

- **Production / Preview:** values are set in the Vercel dashboard.
- **Local dev:** copy the vars into a `.env.local` file (gitignored — never
  commit real values).

## Continuing the work

This project is developed with help from **Claude**. Useful references:

- [Claude Code documentation](https://code.claude.com/docs) — the CLI and
  web/agent workflows used to build this
- [Claude Docs](https://docs.claude.com) — the Claude models and API
- [Anthropic](https://www.anthropic.com) — the company behind Claude
