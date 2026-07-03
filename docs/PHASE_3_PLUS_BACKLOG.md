# Phase 3+ Backlog (banked ideas)

Ideas parked for after Phase 2 ships. Not committed work — just a place to keep
good ideas from getting lost. Move an item up into a phase brief when it's time.

## Astronomically-correct object flavor lines

Compute the objects that are *actually visible* over Kos tonight — client-side,
no external API — using [`astronomy-engine`](https://github.com/cosinekitty/astronomy)
(pure JS, offline, no key). Feed that into the `/live` flavor-text so object-
specific lines are always astronomically correct: only say "Saturn's up in the
southeast" when Saturn is genuinely above the horizon in that direction from Kos
at that moment.

- Inputs: Kos lat/long + current time → alt/az for planets, Moon, and a handful
  of showpiece deep-sky objects.
- Output: a dynamically-built pool of true-right-now lines that slots into the
  existing rotating flavor mechanism (see `lib/live-copy.ts`), replacing or
  augmenting the hand-written GENERAL pool during clear-sky hours.
- Why it's banked: the Phase 2 flavor feature is hand-authored copy; this makes
  it self-correcting and richer, but needs the ephemeris work and horizon/
  visibility thresholds to be worth trusting.
