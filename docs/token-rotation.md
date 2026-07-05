# INGEST_SECRET rotation

Practical checklist for rotating the `/api/ingest` bearer token. Follow this
in order; don't skip the verify step.

## When to rotate

- **Routine**: periodically (e.g. once a season) as general hygiene.
- **Emergency**: immediately if the tablet is lost/stolen, or you suspect the
  token has leaked (visible in a screen recording, shared screenshot, synced
  to a cloud backup you don't control, etc.).

## Before you start

- Do this **between events, not during one**. There's a brief window where
  in-flight requests signed with the old token will 401 — rotating mid-event
  will drop real frames.
- Have access ready: Vercel dashboard (env vars + redeploy) and the tablet
  (to edit the relay's `.env` and restart it).

## Steps

1. **Generate a new secret.** Any long random string works, e.g.:
   ```
   openssl rand -hex 32
   ```
2. **Update Vercel.** Project → Settings → Environment Variables → edit
   `INGEST_SECRET` → paste the new value → save.
3. **Redeploy.** Env var changes don't apply to already-running instances —
   trigger a redeploy (Vercel dashboard → Deployments → Redeploy on the
   latest production deployment, or push a commit).
4. **Update the tablet.** Edit the relay's `.env` (or wherever it reads the
   ingest token from) to the new secret.
5. **Restart the relay** on the tablet so it picks up the new value.
6. **Verify the new secret works.** Run the relay's ingest-verification
   check (the same smoke test used to confirm production ingest after a
   deploy) and confirm a frame lands on `/live`.
7. **Confirm the old secret is dead.** Try an ingest request with the old
   token (or just note that step 2 already overwrote it — there's only one
   `INGEST_SECRET` value at a time, so once step 3's redeploy is live, the
   old token is a plain wrong-token 401, no separate revocation step needed).

## Notes

- There's no token versioning/rotation-with-overlap here — `INGEST_SECRET`
  is a single value. Rotating always means a hard cutover: the moment the
  new deployment is live, the old token stops working entirely. That's why
  step 4-5 (updating the tablet) needs to happen close in time to step 2-3
  (updating Vercel), not hours apart.
- If you rotate in an emergency and can't get to the tablet immediately,
  ingest will simply fail (401) until you do — the site stays up, `/live`
  just won't show new frames. Better than leaving a compromised token live.
