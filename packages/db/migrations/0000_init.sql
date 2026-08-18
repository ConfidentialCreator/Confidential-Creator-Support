CREATE TABLE "indexer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_sig" text,
	"last_slot" numeric(20, 0),
	"updated_at" timestamp with time zone NOT NULL
);

--> statement-breakpoint
-- The api reads through `ccs_api` and cannot write: only the worker (role postgres)
-- follows the chain. NOLOGIN here — the password is set by the operator, never by
-- a file in the repo: ALTER ROLE ccs_api LOGIN PASSWORD '...';
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ccs_api') THEN
		CREATE ROLE ccs_api NOLOGIN;
	END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ccs_api;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ccs_api;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO ccs_api;
