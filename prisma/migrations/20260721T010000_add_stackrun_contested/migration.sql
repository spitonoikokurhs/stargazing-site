-- Add the contested-field fact (matchCoordinates.hasInRangeRunnerUp) to
-- StackRun so the TAPPABLE session-history strip can gate a pill's name on the
-- same fact the live card uses (a tapped contested-medium pill would otherwise
-- render a possibly-wrong named card). Nullable and additive: null on runs
-- with no match and on all rows predating this column (client treats null as
-- false = "not contested" = today's behavior); a real boolean on
-- matched/upgraded runs written after deploy. Safe on existing data.
ALTER TABLE "StackRun" ADD COLUMN "hasInRangeRunnerUp" BOOLEAN;
