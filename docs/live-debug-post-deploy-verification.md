# /live-debug — post-deploy production verification

**Why this exists.** The unit tests (`scripts/test-status-debug.mjs`,
`scripts/test-status-debug-route.mjs`) prove the gate logic, the cookie
expiry, and the relay-field passthrough. What they CANNOT prove is the thing
actually worth fearing: a **cached debug response being served to a guest**.
That is CDN / Vercel-edge behaviour, invisible to any in-process test. **This
check closes that gap, and can only be run after deploy.**

Two modes, because the right assertion depends on whether a finished flag is set:

- **Finished-stable** (you just hit "finish night", no relay running, guest sees
  the farewell): the guest response is constant, so a **byte-diff** before/after
  a debug request is the strongest check — it proves nothing leaked AND nothing
  changed.
- **Live or idle** (frames are flowing, or nothing scheduled): the guest body
  legitimately changes frame-to-frame, so a byte-diff would false-alarm. Instead
  assert the **guest-safe shape**: `live` is present, the `debug` key is ABSENT,
  and the caching headers are correct. Run this mode any time.

---

## Setup

```bash
BASE="https://stargazing.world"     # production origin (adjust if different)
TOKEN="<DEBUG_VIEW_TOKEN>"          # the dedicated read-only debug token (NOT INGEST_SECRET)
```

The `?debug=1` curl calls can authenticate two ways — verify BOTH, since guests
use the cookie path and curl/monitoring use the Bearer path:
- **Bearer** header (steps 2–6).
- **Signed cookie** via the real bootstrap (step 7) — the path the browser uses.

---

## Step 1 — Plain guest request: capture body AND headers

```bash
curl -sS -D - "$BASE/api/status" -o /tmp/guest-before.json
echo "--- body ---"; cat /tmp/guest-before.json
```

Confirm (BOTH modes):
- The `debug` key is **absent** from the body:
  `jq 'has("debug")' /tmp/guest-before.json` → **`false`**.
- Body is a guest-safe shape (`live` present; during a finished window,
  `finished:true`).
- Response headers include:
  `cache-control: no-store, no-cache, must-revalidate, proxy-revalidate`,
  `pragma: no-cache`, `expires: 0`, `vary: Authorization, Cookie`.
- **No** `x-vercel-cache: HIT` (`MISS`/`BYPASS`/absent is fine).

## Step 2 — Authenticated debug request (Bearer): live data + debug fields

```bash
curl -sS -D - -H "Authorization: Bearer $TOKEN" "$BASE/api/status?debug=1" -o /tmp/debug.json
echo "--- body ---"; cat /tmp/debug.json
```

Confirm:
- Body is a **live** payload (`"live":true` + `frame` + a `debug` object) or, if
  the relay isn't sending, `{"live":false,"debugNoFeed":true,...}`. Either way it
  is NOT the guest `finished` farewell — the bypass is the whole point.
- `jq '.debug | keys' /tmp/debug.json` shows the diagnostic fields. When the
  relay is sending them, `astrometrySolveSuspect`, `solveTiming`,
  `coordSourcesDisagree`, mount coords, etc. appear here; if they DON'T appear
  while the relay is definitely emitting them, the field-name wiring is off (see
  docs/live-debug-relay-fields-TODO.md).
- Headers: `cache-control: private, no-store, …` and `vary: Authorization, Cookie`.

## Step 3 — Unauthenticated debug -> 401 (never a guest fall-through)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/api/status?debug=1"          # -> 401
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/api/status?debug=true"       # -> 400 (malformed)
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/api/status?debug=1&event=x"  # -> 400 (v1: no event)
```

Confirm the codes above. A `200` on the first would mean debug fell through to
the guest path — it must not.

## Step 4 — THE REAL FEAR TEST: plain guest request AGAIN

```bash
curl -sS -D - "$BASE/api/status" -o /tmp/guest-after.json
```

**Finished-stable mode** — byte-diff must be identical:

```bash
diff /tmp/guest-before.json /tmp/guest-after.json && echo "IDENTICAL ✓" || echo "DIFFERENT ✗ — investigate"
```

**Live/idle mode** — the body legitimately changes, so instead assert guest-safe:

```bash
jq -e 'has("debug") | not' /tmp/guest-after.json >/dev/null && echo "no debug key ✓" || echo "LEAKED debug key ✗"
jq -e 'has("live")' /tmp/guest-after.json >/dev/null && echo "guest shape ✓" || echo "unexpected shape ✗"
```

In BOTH modes confirm headers still show `no-store` and **no** `x-vercel-cache: HIT`.

> The failure this catches: a guest response that now carries a `debug` object
> (or, in finished mode, differs from step 1) means an edge/CDN cache captured
> the debug response and is replaying it to guests. That is the one genuinely
> bad outcome — stop and roll back.

## Step 5 — Reading Vercel cache headers

On each `-D -` dump, check:
- `x-vercel-cache:` — `MISS`/`BYPASS`/absent. **Never `HIT`** on `/api/status`
  (it's `dynamic = 'force-dynamic'`).
- `cache-control:` — the `no-store…` string above, NOT rewritten by Vercel to
  `public, max-age=…`.
- `age:` — absent or `0`. Non-zero means a shared cache is holding it.

```bash
curl -sS -D - "$BASE/api/status" -o /dev/null | grep -iE "cache-control|x-vercel-cache|age:|vary|pragma|expires"
```

## Step 6 — Fail-closed check (optional, if you can toggle env)

With `DEBUG_VIEW_TOKEN` unset on the deployment, `?debug=1` with any Bearer must
return **401**, and `/live-debug` must show the locked page — the surface fails
CLOSED, never falling back to a write-capable credential.

## Step 7 — Cookie-path check (the browser's actual auth)

Bearer proves the endpoint; this proves the **signed-cookie bootstrap** the
browser uses. Use a curl cookie jar:

```bash
# 7a. Bootstrap: hit /live-debug/auth?token=… and capture the Set-Cookie into a jar.
curl -sS -c /tmp/dbg.jar -D - -o /dev/null "$BASE/live-debug/auth?token=$TOKEN" \
  | grep -iE "set-cookie|location|referrer-policy"
```

Confirm the `set-cookie:` line shows `sg_debug=<digits>.<hex>` with
`HttpOnly`, `Secure`, `SameSite=Strict`; a `location:` of `/live-debug` (no
token); and `referrer-policy: no-referrer`.

```bash
# 7b. Use the jar (NO Bearer) to call the debug status — the cookie alone authenticates.
curl -sS -b /tmp/dbg.jar "$BASE/api/status?debug=1" | jq '{live, debugNoFeed, hasDebug: has("debug")}'
```

Confirm `hasDebug: true` (live or no-feed) — the cookie authorised the call.

```bash
# 7c. A wrong token mints NO cookie -> the jar stays empty -> the call is 401.
curl -sS -c /tmp/bad.jar -o /dev/null "$BASE/live-debug/auth?token=wrong"
curl -sS -b /tmp/bad.jar -o /dev/null -w "%{http_code}\n" "$BASE/api/status?debug=1"   # -> 401
rm -f /tmp/dbg.jar /tmp/bad.jar
```

## Browser sanity (optional, ~30s)

1. `$BASE/live-debug/auth?token=<TOKEN>` on your phone → lands on `/live-debug`
   (tokenless) showing the live view + debug overlay, even when guests on `/live`
   see the farewell.
2. `$BASE/live-debug` in a fresh private window (no cookie) → **"Debug view
   locked"**, never the feed, never an error.

---

## Cookie lifetime (for the venue)

- The `sg_debug` cookie is a **signed value with an embedded 12-hour expiry that
  the server enforces** — not just a browser hint. After 12h it stops being
  accepted regardless of the browser, and it can't be extended without the token
  (the HMAC covers the expiry).
- If it expires mid-session, hit `/live-debug/auth?token=…` again to mint a fresh
  one and get redirected back to the clean URL.
- `/live-debug` with a missing/expired/stale cookie renders `DebugUnauthorized`
  (the "Debug view locked" card), not an error — a lapsed cookie is a re-auth,
  never a broken page.
