-- Seconds, not `3 days`: a calendar day of a timestamptz depends on the session time zone,
-- while the program counts an absolute 259200. `packages/db/src/periods.test.ts` checks this
-- literal against `fixtures/periods.json`, which the program and `packages/shared` check too.
-- STABLE, not IMMUTABLE: `timestamptz + interval` is itself stable in postgres.
CREATE OR REPLACE FUNCTION ccs_is_active(expires_at timestamptz, at_time timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
PARALLEL SAFE
AS $$ SELECT expires_at + interval '259200 seconds' > at_time $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ccs_is_active(timestamptz, timestamptz) TO ccs_api;
