-- Add the contested-field fact (matchCoordinates.hasInRangeRunnerUp) to the
-- MatchDecision diagnostic record. Nullable and additive: null on fallback
-- rows (no winning match) and on all rows predating this column; a real
-- boolean on matched/upgraded decisions written after deploy. Safe on existing
-- data (no default, no backfill, no NOT NULL).
ALTER TABLE "MatchDecision" ADD COLUMN "hasInRangeRunnerUp" BOOLEAN;
