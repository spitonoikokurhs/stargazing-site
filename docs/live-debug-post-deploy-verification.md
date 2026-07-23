# /live-debug — post-deploy production verification

**Why this exists.** The unit tests (`scripts/test-status-debug.mjs`) prove the
GATE LOGIC is correct — an unauthenticated `?debug=1` is a 401, an authorized
one bypasses the finished flag, and the gate is stateless so a debug request
leaves no residue. What they CANNOT prove is the thing actually worth fearing:
a cached debug response being served to a guest. That is CDN / Vercel-edge
behaviour, invisible to any in-process test. **This check closes that gap, and
can only be run after deploy.**

Run it once, right after the `/live-debug` deploy promotes to production, ideally
while the event is FINISHED (finished flag set) so step 1 and step 4 actually
show `finished:true`. If you run it outside a finished window, substitute
"whatever the guest currently sees" for `finished:true` — the point of steps
1↔4 is that the guest response is UNCHANGED across a debug request, whatever its
current state.

---

## Setup

```bash
BASE="https://stargazing.world"          # production origin (adjust if different)
TOKEN="<VIEWER_STATS_TOKEN or INGEST_SECRET>"   # the same secret /live-debug/auth accepts
```

The `?debug=1` curl calls authenticate with a **Bearer header** (the cookie path
is browser-only; curl uses the header — both are accepted by the same
`isDebugAuthorized`).

---

## Step 1 — Plain guest request: capture body AND headers

```bash
curl -sS -D - "$BASE/api/status" -o /tmp/guest-before.json
echo "--- body ---"; cat /tmp/guest-before.json
```

Confirm:
- Body shows the **guest** state (e.g. `{"live":false,"finished":true,...}` during
  a finished window).
- Response headers include:
  `cache-control: no-store, no-cache, must-revalidate, proxy-revalidate`
  `pragma: no-cache`, `expires: 0`, `vary: Authorization`.
- **No** `x-vercel-cache: HIT` (a `MISS` or absent is fine; a `HIT` here would
  be the red flag — see "Reading Vercel cache headers" below).

## Step 2 — Authenticated debug request: confirm it returns LIVE data despite finished

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" "$BASE/api/status?debug=1" -o /tmp/debug.json
echo "--- body ---"; cat /tmp/debug.json
```

Confirm:
- Body is a **live** payload (`"live":true`, a `frame`, and a `debug` object) — or,
  if the relay isn't currently sending, `{"live":false,"debugNoFeed":true,...}`.
  Either way it is NOT the guest `finished` farewell response — that is the whole
  point: an authorized caller bypasses the finished flag.
- The `debug` object is present (raw RA/Dec, match, nearest, etc.).
- Response headers include `cache-control: private, no-store, ...` and
  `vary: Authorization`.

## Step 3 — Sanity: debug request WITHOUT the token is a 401 (not a guest fall-through)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/api/status?debug=1"
```

Confirm: prints `401`. (Not `200`. A 200 here would mean the debug param silently
fell through to guest behaviour — it must not.)

## Step 4 — THE REAL FEAR TEST: plain guest request AGAIN, must be UNCHANGED

```bash
curl -sS -D - "$BASE/api/status" -o /tmp/guest-after.json
echo "--- diff of guest body before vs after the debug request ---"
diff /tmp/guest-before.json /tmp/guest-after.json && echo "IDENTICAL ✓" || echo "DIFFERENT ✗ — investigate"
```

Confirm:
- The diff prints **`IDENTICAL ✓`** — the guest body is byte-for-byte the same as
  step 1, i.e. still `finished:true`. A debug request served in between did NOT
  change what a guest sees, AND no cache served the guest the debug body.
- Headers still show `no-store` and **no** `x-vercel-cache: HIT`.

> The failure this catches: if `diff` shows the guest now receiving live data /
> the `debug` object, an edge or CDN cache captured the debug response and is
> replaying it to unauthenticated guests. That is the one genuinely bad outcome
> the whole design guards against — stop and roll back if you see it.

---

## Reading Vercel cache headers

In each `-D -` (dump-headers) output, check:

- `x-vercel-cache:` — should be `MISS`, `BYPASS`, or absent. **Never `HIT`** on
  `/api/status` (it's `dynamic = 'force-dynamic'`, so Vercel should not edge-cache
  it at all).
- `cache-control:` — must be the `no-store…` string above, NOT something Vercel
  rewrote to `public, max-age=...`. If Vercel added its own caching, the
  directives we send would be overridden — investigate the project's
  Edge/CDN settings.
- `age:` — should be absent or `0`. A non-zero `age` means a shared cache is
  holding and re-serving the response.

A quick one-liner to eyeball just the cache-relevant headers on any of the calls:

```bash
curl -sS -D - "$BASE/api/status" -o /dev/null | grep -iE "cache-control|x-vercel-cache|age:|vary|pragma|expires"
```

---

## Browser sanity (optional, ~30s)

1. On your phone, open `https://stargazing.world/live-debug/auth?token=<TOKEN>`
   once. It should land on `/live-debug` (tokenless URL) showing the live view +
   debug overlay, even when guests on `/live` see the farewell.
2. Open `https://stargazing.world/live-debug` in a private window with no cookie.
   It should show the **"Debug view locked"** notice — never the live feed, never
   an error.

---

## Cookie lifetime (for the venue)

- The `sg_debug` cookie lasts **12 hours**. If it expires mid-session, just hit
  `/live-debug/auth?token=…` again to mint a fresh one and get redirected back to
  the clean URL.
- `/live-debug` with a missing/expired/stale cookie renders `DebugUnauthorized`
  (the "Debug view locked" card), not an error — so a lapsed cookie is a
  re-auth, never a broken page.
