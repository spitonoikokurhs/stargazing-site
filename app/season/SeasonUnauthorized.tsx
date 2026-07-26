// Shown at /season when the sg_debug cookie is absent, stale, or no secret is
// configured — same terse, non-leaky posture as DebugUnauthorized (which see):
// no wrong-vs-missing distinction, one recovery instruction, no token printed.
export function SeasonUnauthorized({ configured }: { configured: boolean }) {
  return (
    <main className="season-unauth">
      <div className="season-unauth-card">
        <h1>Season view locked</h1>
        {configured ? (
          <p>
            This is a private operator view. Open it with your bootstrap link (<code>/season/auth?token=…</code>) to
            sign in, then return here. An active /live-debug sign-in also unlocks this page.
          </p>
        ) : (
          <p>
            Operator access isn’t configured on this deployment. Set a <code>DEBUG_VIEW_TOKEN</code> to enable it.
          </p>
        )}
        <a href="/">← Back to site</a>
      </div>
    </main>
  )
}
