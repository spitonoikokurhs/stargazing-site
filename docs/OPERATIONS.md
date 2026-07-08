# Operations Reference

## 1. Operator workflow

Correct sequence for starting a new stack:

1. **Slew to target** (GoTo)
2. **Platesolve** — confirm where the mount actually landed
3. **Center the object** — nudge until dead-center in the frame
4. **Confirm dead-center** in the live view
5. **Then** click **"New Observation"** in SmartEye to start stacking

**Critical:** starting the stack *before* centering is complete causes the
astrometry solve to reflect the pre-centering GoTo position (potentially
~1–2° off the true target). This solve then persists stale for the entire
stack — SmartEye does **not** re-solve per frame; it serves the stack's
reference-frame solve. Confirmed in the OKU July 7 session: M57 was visibly
dead-center in the image, but the reported RA/Dec was 2.1° away, from a
pre-centering GoTo landing.

**If you forget to stop the previous stack before slewing** (happens
mid-event): the stack auto-restarts on the rough GoTo landing position,
SmartEye solves *that* position, and the subsequent centering move does not
trigger a re-solve. Result: correct image, wrong label.

## 2. Stale astrometry — known behavior

SmartEye reports `astrometryState: "solved"` with the **most recent
successful solve**, not a fresh per-frame solve. This means:

- RA/Dec can be bit-identical across dozens of frames for 10+ minutes — this
  is **normal** API behavior, not a bug.
- The solve reflects the stack's reference frame (typically the first frame
  after "New Observation").
- `totalAccumulatedTime` advances independently and is the **reliable**
  signal for stack progression.
- The astrometry timestamp (logged by the relay as of July 8, 2026) is the
  falsifier — if it doesn't advance, the solve is stale.

### Detection architecture

- **`detectTransition`** (`lib/detect-transition.ts`) uses a
  `totalAccumulatedTime` reset as the primary signal — coordinate-blind by
  design, so it works correctly through stale-astrometry episodes.
- **`assessAstrometryFreshness`** (same file) checks timestamp freshness —
  unvalidated against real data as of writing, awaiting real SmartEye
  timestamp data from the Parnonas session. Provisional 90s staleness
  threshold, chosen against the OKU log's 12+ minute frozen-coordinate case.
- These are deliberately **separate concerns**: a new stack run ≠ a new sky
  target, and stale coordinates ≠ same target.
