# Operations & Build Notes

Running notes captured during Phase 2 build. Distinct from `PHASE_2_BRIEF.md`
(the plan) — this is implementation guidance and operational checklists that
emerged from code review.

## For the `/api/status` build (review bucket b)

Carry these into the `/api/status` endpoint when it's built:

- **Liveness is computed from `ingestedAt`, not `capturedAt`.** `capturedAt` is a
  device-reported timestamp and is display-only (it can lag or lie); server
  receipt time is the source of truth for "are we live in the last 5 minutes?".
- **Defensive Redis parse.** The reader must accept both a JSON string and an
  already-parsed object from `redis.get` (the Upstash client may auto-deserialize
  values that look like JSON). Parse leniently; never throw on a malformed value.
- **Source-switch hysteresis.** Don't flip the active source on every poll. Only
  switch away from the current source if the other source is fresher by a margin,
  or if the current source has gone stale (past the liveness window). Prevents
  flapping when both `pegasus` and `seestar` are live simultaneously.
- **`Cache-Control: no-store` initially.** The status endpoint must not be cached
  by the CDN/browser while we validate behavior. Revisit caching later if load
  warrants it, but start with no-store.

## Pre-first-hotel-night checklist (review bucket c)

Do NOT need these for the code to work, but they must be in place before the
first real event night in front of guests:

- **Post-auth rate limiting** on `/api/ingest` — cap requests per source after a
  valid secret, so a misbehaving/looping relay can't hammer Blob/DB.
- **Relay backoff + visible status** — the Termux relay should back off on
  errors (not tight-loop retry) and surface its own state (last success, last
  error) so a problem is noticeable at the venue.
- **Operator checklist card** — a physical/printed card for setup at the venue
  (power, hotspot, relay start, confirm frames landing on `/live`).
- **`INGEST_SECRET` rotation procedure** — documented steps to rotate the secret
  in Vercel + the relay without downtime, in case it leaks.
