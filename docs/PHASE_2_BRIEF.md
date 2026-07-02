# Phase 2 Brief — Stargazing.events Live View

**Date:** 28 June 2026
**Status:** Phase 1 (Next.js conversion) complete and live in production. This brief defines Phase 2 work.

---

## Where we are now

### Phase 1 — done and live

The stargazing.events site is now running on Next.js 14 (App Router) on Vercel. Three pages live: `/`, `/bodrum-hotelleri`, `/privacy`. Dynamic `/robots.txt` and `/sitemap.xml`. Vercel Analytics + Speed Insights collecting real data. Cookie consent banner with GA4 Consent Mode v2 working correctly. SEO foundation in place (title templates, canonical URLs, hreflang, JSON-LD).

The conversion produced 9 clean git commits on `main`, no production downtime, no visible change for visitors. Pixel-identical to the previous static site.

### Infrastructure already provisioned (sitting idle, waiting for Phase 2)

These were set up earlier today but not yet used by any code:

- **Vercel Blob storage** (Frankfurt region) — token `BLOB_READ_WRITE_TOKEN` in env. This is where live image frames will be stored.
- **Upstash Redis** (Frankfurt, free tier) — env vars `UPSTASH_KV_REST_API_URL`, `UPSTASH_KV_REST_API_TOKEN`, `UPSTASH_REDIS_URL`. Used for short-lived state like "current live image URL" and "viewer count."
- **Neon Postgres** (Frankfurt, free tier, 0.5 GB) — env vars `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`. Used for permanent records: sessions, objects observed, email signups.
- **Custom env vars** (Production + Preview, marked sensitive):
  - `INGEST_SECRET` — the password the Termux relay sends with each image upload. Already set.
  - `ADMIN_PASSWORD` — for the admin panel we'll build in Phase 4.
  - `SESSION_COOKIE_SECRET` — for signed cookies (admin login, viewer ID).

### Hardware ready

- **Pegasus Astro SmartEye telescope** at events. Confirmed working endpoint: `http://smarteye.local/images/latest.png` returns the current live-stacked image as a 3.3 MB PNG (full resolution, 2560×2560).
- **OnePlus Pad with Termux + Python** as the relay device. Successfully downloaded test images from the SmartEye. Battery optimization disabled.
- **OnePlus 11 phone** as cellular hotspot — SmartEye and pad both join the phone's WiFi.

### Documents already prepared

- `SPEC.md` — original developer specification (will be updated based on this brief)
- `SmartEye-Feature-Spec.md` — formal feature request for Pegasus Astro engineering
- `SmartEye-Connectivity-Requirements.md` — exploratory networking notes
- `ClaudeDesign-Brief.md` — the brief that produced the design we now have in hand

### Design from Claude Design — done

A visual design for the live view experience exists. Three layouts: desktop (the "wow shot"), tablet, mobile (live / offline / night mode states). Aesthetic locked: dark navy `#05060B` background, warm gold and soft blue accents, Cormorant Garamond display + Inter UI + Spectral body. The hero image is always the focus. Includes UI for the LIVE indicator with viewer count, the object identity card (name, type, location in sky, magnitude, distance), stacking progression frames (T+0s / T+60s / T+180s / T+300s), Wikipedia link, download button, history section (past observations), and email signup form for return visitors.

---

## How viewers will access the live view

This needs to work in three distinct contexts. Each has different priorities.

### Context 1 — The hotel kiosk / common area screen

A TV or large screen at the hotel where the event is happening, set up at the start of the evening. Shows the live view to guests in the lobby or bar who didn't make it to the stargazing session but can still see what's happening. Also serves as a passive marketing surface — anyone walking past sees the brand and the live cosmos.

**URL:** `stargazing.events/live` — clean root URL, no parameters. The page auto-detects "we're live tonight" and renders the live view. No login, no QR scanning required for the screen.

**Setup at the venue:** Plug a Fire Stick or Chromecast into the TV, open the browser to `stargazing.events/live`, full-screen it. Five seconds of work. Or use a hotel TV's built-in browser if available.

**Display considerations:** The page should detect very large viewports and switch to a kiosk-friendly layout — bigger type, slower transitions, less UI chrome. The Claude Design "wow shot" desktop layout works for this with minimal modification.

### Context 2 — Guests scanning a QR code at the live event

The person is physically at the stargazing event with you. They want to view the live image on their own phone — to take a closer look, to save the image, to share it with friends not present, or just to look at the object alongside the telescope view.

**QR code:** Printed on a small card you bring to each event. Points to `stargazing.events/live`. Same URL as the kiosk. The site is mobile-responsive (we already verified our Next.js site works on mobile) so the same page just adapts to phone-sized viewports — the design includes mobile layouts.

**Cross-event consistency:** One QR code per *event series*, not per night. The same card works at every hotel, every night. The site figures out which hotel based on the day of the week and the time of day.

### Context 3 — Visitors who weren't at the event

The interesting case. Someone arrived at the site from social media, or because they were at an event last week and want to see what tonight looks like, or because they signed up for the email list.

**URL:** `stargazing.events/live` — same URL, different page state.

**If we're live right now:** They see the current live image and join the viewer count. Same experience as Context 2.

**If we're not live (daytime, weather cancelled, off-season):** They see the offline state — last night's hero image, a quiet statement of where we'll be next ("Next live session: Friday at Caravia Beach Hotel, around 10pm"), and the email signup. The Claude Design mobile-offline layout shows this state exactly.

---

## How the system decides "are we live right now?"

This is the question the page asks every time someone loads it. The answer drives whether they see a live image or an offline state.

The decision uses a combination of three signals:

1. **Hotel schedule** — a static JSON file in the repo lists which hotel hosts on which day of the week, with the typical event time window. Example: Monday → OKU Kos, 22:00 to 23:30. The server reads this on every page load. (Editable in the admin panel later — for now, just maintain by hand.)
2. **Recent ingest activity** — the API endpoint receiving images from the SmartEye relay updates a Redis key every time a frame arrives. If the most recent frame is less than 5 minutes old, we're live regardless of what the schedule says (covers ad-hoc events, weddings, private bookings).
3. **Manual override** — an admin endpoint to force the system into "live" or "offline" state, mainly for testing or unusual situations.

If any of these three says "live," the page shows live. Otherwise, offline state.

---

## The live mode — what happens during a session

Walk through a typical Friday night:

**21:45** — You arrive at the hotel. Set up the telescope, the SmartEye, the OnePlus phone hotspot, the OnePlus Pad with Termux. Plug the Fire Stick into the TV in the lobby and open `stargazing.events/live`. The site sees "no recent frame" → shows offline state with "Next session: tonight at this hotel, around 10pm." Fine.

**22:00** — Telescope tracks to first object (say, the Andromeda Galaxy). SmartEye starts stacking. You start the relay script on the OnePlus Pad. It begins POSTing frames to `stargazing.events/api/ingest` every 30 seconds.

**22:00:15** — First frame lands. Vercel Blob stores it. Redis key "current live image" updated. "Most recent frame timestamp" updated. Postgres gets a new row in the `sessions` table (if not started) and the `observations` table (new object: Andromeda Galaxy, started at 22:00).

**22:00:30** — Anyone refreshing `stargazing.events/live` now sees the live view. The page polls the API every 10 seconds for the latest image URL and updates if it changed. The TV in the lobby is now showing the live cosmos.

**22:00:35** — A background job sends a push notification + email to subscribers who opted in for "notify me when there's a new live session." (More on this below.)

**22:00–22:15** — Andromeda Galaxy stacks deeper. The system captures specific milestones: T+0s, T+60s, T+180s, T+300s (the four frames for the "stacking progression" display in the design). All other frames are still stored but not highlighted in the UI.

**22:15** — You point the telescope at a new object (the Orion Nebula). New observation row in Postgres. Subscribers who joined within the last 30 minutes don't get a second notification immediately, but the daily summary tomorrow morning includes both objects.

**22:00–23:30** — Session continues. Maybe 4-6 objects observed total. Each one gets the same treatment.

**23:30** — You pack up. Last frame is at 23:32. After 5 minutes of no new frames, the site automatically returns to offline state. The TV at the hotel still shows the page, now showing the last object as the "hero" image until refresh.

**Next morning** — A summary is generated. Each subscriber receives one quiet email: "Last night at Caravia Beach Hotel: Andromeda, Orion Nebula, Saturn, ..." with thumbnails. Link to view each in detail.

---

## Notifying people about new live sessions

This is the question you asked: how do we tell past visitors that we're live with a new object?

Three layers, ordered by friction and impact.

### Layer 1 — Email signup on the offline state

The Claude Design layout already includes this. When the live page is in offline state, there's a quiet email input ("One quiet email before each event near you. No spam, unsubscribe anytime"). They enter their email and submit.

**What they get:**
- An email about 15 minutes before each live session starts ("Tonight at Caravia Beach Hotel — Stargazing live from 10pm. We'll start with the Andromeda Galaxy.")
- An email the next morning summarizing what was observed ("Last night's tour: 5 objects, including a face-on spiral galaxy 31 million years away. View all images →")

**What they don't get:**
- No spam, no third-party offers
- No marketing for unrelated services
- No more than 2-3 emails per active week, far less out of season
- Easy unsubscribe in every email

**Implementation:** Email addresses stored in Postgres in a `subscribers` table with their email, signup timestamp, and a list of consent flags. Email sending via Resend (recommended) or Postmark — both free for low volumes. Triggered by a Vercel Cron job that runs every 15 minutes during typical event hours (21:00 to 23:00 in season) and checks "is there a new live session that just started? Have we already notified about it?"

### Layer 2 — Browser push notifications (optional, opt-in)

For visitors who want more immediate updates — the few who really care, like astrophotography enthusiasts or guests who attended a session and want to know when the next one starts.

When someone enables push notifications, their browser registers with our server. When a new session begins, we send a push that pops up on their phone or laptop even when they don't have the site open: "Stargazing live now — Whirlpool Galaxy from Santorini Vista Hotel."

**Cost:** Free using the web Push API + a small library like `web-push`. No third-party service needed.

**Complexity:** Moderate. Requires VAPID keys, service worker, subscription storage in Postgres. About 200 lines of code total. Probably not worth doing in Phase 2 — adds 1-2 days of work for a feature that 5-10% of visitors will use. **Recommendation: defer to Phase 4.**

### Layer 3 — Social media drumbeat

Not a software feature, but worth naming. When a session goes live, the system can:

- Automatically post a tweet/Instagram story with the current hero image (using the platform APIs)
- This is more marketing than notification — it brings in new visitors rather than re-engaging known ones

**Recommendation:** Defer this to Phase 5 or later. It's nice-to-have but not core to the live view experience.

### Concretely for Phase 2

Build **only Layer 1** (email signup + scheduled emails). That covers the 90% case — people who attended an event and want to know about future ones, plus people who found the site through SEO or social and want to be told when there's something to see.

The infrastructure pieces:

- A new database table `subscribers` (email, created_at, locale, status, unsubscribe_token)
- A POST endpoint `/api/subscribe` that accepts an email and stores it
- A POST endpoint `/api/unsubscribe?token=…` that removes a subscriber
- A scheduled Vercel Cron job that, every 15 minutes during event hours, checks for new sessions and sends pre-session announcement emails
- A second cron job that runs every morning at 09:00 to send the previous-night summary
- Email templates (HTML + plain text) for both kinds of email, in English and Turkish

Resend is the recommended email provider — 3,000 emails/month free, simple API, great deliverability. Postmark is the close runner-up.

---

## Multi-source ingest (Pegasus SmartEye + Seestar S50)

Phase 1 assumed a single live-view source (the Pegasus Astro SmartEye). Phase 2 must support **two** devices, either of which can drive the live view on stargazing.events:

- **Pegasus Astro SmartEye** — the existing source, pulled from `http://smarteye.local/images/latest.png` (see Hardware ready above).
- **ZWO Seestar S50** — a second smart telescope acting as an independent live-view source.

**Any single night can run in one of three configurations:**

- Solo Pegasus (Seestar not present)
- Solo Seestar (Pegasus not present)
- Both simultaneously (e.g. two scopes on two objects at the same event)

**The website always shows a single active feed.** It never tries to show two images at once. The rule for picking the active source is simple and stateless: **the source with the most recent frame in the last 5 minutes wins.** This piggybacks on the existing "are we live?" logic (5-minute recency window) — we just track recency *per source* and select the freshest. If both are live, the more recently updated one is shown; when it goes quiet, the other takes over automatically.

**Schema addition.** Both the `frames` and `sessions` tables gain a `source` field with values `"pegasus"` or `"seestar"`. Every ingested frame is tagged with its origin, and sessions record which device produced them. This is what makes per-source recency selection possible, and it keeps the historical record honest about which instrument captured a given observation.

**Relay implications.** Instead of one Termux relay script, there are now **two separate scripts — one per device** — running on the relay hardware (OnePlus Pad, and/or a second Termux host). Both POST to the *same* `/api/ingest` endpoint, each including a `source` identifier (`pegasus` or `seestar`) in the request. The ingest endpoint uses that identifier to tag the frame and update the correct per-source recency key in Redis. Keeping the scripts separate (rather than one script polling both devices) means either can start, stop, or fail independently without affecting the other.

**Open sub-question — pulling the latest frame from the Seestar.** The SmartEye exposes a clean HTTP endpoint (`/images/latest.png`). The Seestar S50 does **not** have an obvious equivalent documented. Before the Seestar relay script can be written, we need to research how to programmatically pull its latest stacked frame. Candidate approaches to investigate: the `python-seestar` library, `seestar_alp` (the ALPACA-based community project), or other community reverse-engineering efforts around the Seestar's app/network protocol. This is a research spike that should happen early — it may constrain how the Seestar relay works (polling a local endpoint vs. intercepting the app's data vs. an ALPACA driver), and it's currently the biggest unknown in the multi-source plan.

---

## What Phase 2 needs to build (the actual work list)

Concrete deliverables, in dependency order:

1. **Postgres schema** — tables for `sessions`, `observations`, `frames`, `subscribers`. Migration script. The `frames` and `sessions` tables include a `source` field (`"pegasus"` | `"seestar"`) to tag which device produced each frame/session (see Multi-source ingest above).
2. **`/api/ingest` endpoint** — receives image uploads from the Termux relay(s). Authenticates via `INGEST_SECRET`. Reads a `source` identifier (`pegasus` | `seestar`) from the request and tags the frame with it. Stores image in Vercel Blob. Updates the per-source Redis "current live image" / recency keys (the freshest source in the last 5 minutes becomes the active feed). Inserts row in `frames` table with its `source`. Handles "new object" detection (compares to last frame's metadata, creates new observation if object changed).
3. **`/api/status` endpoint** — public endpoint the live page polls every 10 seconds. Returns current state: live or offline, current object info, viewer count, latest image URL.
4. **`/api/heartbeat` endpoint** — anonymous viewer presence tracking. Each viewer hits this every 30 seconds to be counted as "watching." Returns the live viewer count.
5. **Update Termux relay scripts** — two scripts, one per device (Pegasus, Seestar). Each downloads frames from its device and POSTs them to `/api/ingest` with the secret header and its `source` identifier. The Pegasus script extends the existing downloader; the Seestar script depends on resolving the open frame-pull question above.
6. **`/live` page (Next.js)** — implement the Claude Design layouts. Three states: live, offline, night mode. Desktop/tablet/mobile responsive. Polls `/api/status` and updates without full page reload.
7. **`/api/subscribe` and `/api/unsubscribe`** — email signup endpoints.
8. **Vercel Cron jobs** — pre-session email and morning summary.
9. **Resend integration** — email templates and sending logic.

Estimated work: 3-5 focused sessions like Phase 1. The first three items (schema + ingest + status) are the critical path — once those work, you have a working live view even if everything else is stubs.

---

## Decisions you should make before we start Phase 2

A few open questions to settle before the first commit:

1. **Hotel schedule format.** I'll propose a JSON shape; you'll tell me the actual schedule for this season. Mon/Tue/Wed/Thu/Fri × Caravia / OKU / Astir / Palazzo / Paralos × time window.
2. **Email provider — Resend or Postmark?** I recommend Resend (slightly simpler API, generous free tier, modern stack). Postmark is also fine if you prefer their delivery reputation. Either works.
3. **Push notifications — defer to Phase 4 or include in Phase 2?** Strong recommendation: defer.
4. **Hotel kiosk URL — `stargazing.events/live` or a separate path like `stargazing.events/screen`?** I recommend the same URL with viewport detection. Simpler to remember, fewer things to break, and the design is responsive enough.
5. **Privacy implications of viewer counts and email signups.** We need to update the privacy policy to mention email subscriptions and anonymous viewer tracking. Small wording change.
6. **Locale handling for the live page.** Should the live page be Turkish when accessed from `/bodrum-hotelleri`? Or always English? My recommendation: detect from the referring page and/or browser language, but default to English. Turkish version can be added later if a Bodrum event launches.

---

## What Phase 2 will look like as work

The pattern will mirror Phase 1: per-step commits, local testing, Vercel preview verification, then merge to main. The same git hygiene, the same pause-between-steps cadence. The difference is that Phase 2 actually involves new functionality (not just porting), so each step has more thinking and more visible behavior to test.

Roughly the plan will be:

1. Define Postgres schema, create migration, deploy to Neon
2. Build `/api/ingest` and `/api/status` endpoints — pure backend, no UI yet
3. Update Termux relay to POST to ingest
4. Run a live test with the SmartEye at home: trigger ingest, watch Redis update, hit `/api/status`, confirm everything wires together
5. Build the `/live` page minimal version (live state only, no design styling yet)
6. Apply the Claude Design layouts
7. Add offline state and night mode
8. Add email signup endpoint and subscriber table
9. Build email templates
10. Add Vercel Cron jobs
11. End-to-end test: trigger a live session, see the email arrive

Each is a small focused session. The first end-to-end live view (steps 1-5) is the biggest milestone — once you can see your own telescope's output on `stargazing.events/live`, the system exists and everything else is polish.

---

## Next conversation

Open a new chat when you're ready to start. Tell me "ready for Phase 2." I'll have the full context from memory. We start with the decisions above (hotel schedule, email provider, etc.) and then move straight into the Postgres schema.

This brief stays in `/mnt/user-data/outputs/` for reference.
