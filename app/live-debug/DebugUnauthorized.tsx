// Shown at /live-debug when the sg_debug cookie is absent, stale (token
// rotated), or the server has no secret configured. Deliberately terse and
// non-leaky: it does NOT reveal whether a token was wrong vs. never presented,
// and gives the operator exactly one recovery instruction — re-bootstrap via
// /live-debug/auth?token=… — without printing any token itself. Read-only, no
// live data, safe to render to anyone who guesses the URL.
export function DebugUnauthorized({ configured }: { configured: boolean }) {
  return (
    <main className="debug-unauth">
      <div className="debug-unauth__card">
        <h1 className="debug-unauth__title">Debug view locked</h1>
        {configured ? (
          <p className="debug-unauth__body">
            This is a private operator view. Open it with your bootstrap link
            (<code>/live-debug/auth?token=…</code>) to sign in, then return here.
          </p>
        ) : (
          <p className="debug-unauth__body">
            Debug access isn’t configured on this deployment. Set a{' '}
            <code>DEBUG_VIEW_TOKEN</code> to enable it.
          </p>
        )}
        <a className="debug-unauth__home" href="/">
          ← Back to site
        </a>
      </div>
    </main>
  )
}
