CREATE TYPE "public"."contribution_kind" AS ENUM('first', 'renewal');--> statement-breakpoint
CREATE TABLE "contributions" (
	"sig" text PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"supporter" text NOT NULL,
	"slot" numeric(20, 0) NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"periods" smallint NOT NULL,
	"kind" "contribution_kind" NOT NULL,
	"grouped_lo" "bytea" NOT NULL,
	"grouped_hi" "bytea" NOT NULL,
	"proof_sig" text NOT NULL,
	CONSTRAINT "contributions_grouped_lo_len" CHECK (octet_length("contributions"."grouped_lo") = 128),
	CONSTRAINT "contributions_grouped_hi_len" CHECK (octet_length("contributions"."grouped_hi") = 128)
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"wallet" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"suggested_amount" numeric(20, 0) NOT NULL,
	"created_slot" numeric(20, 0) NOT NULL,
	"indexed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "creators_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "pledges" (
	"creator" text NOT NULL,
	"supporter" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"periods_total" integer NOT NULL,
	"contributions" integer NOT NULL,
	"show_publicly" boolean NOT NULL,
	"last_sig" text NOT NULL,
	"last_slot" numeric(20, 0) NOT NULL,
	CONSTRAINT "pledges_creator_supporter_pk" PRIMARY KEY("creator","supporter")
);
--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_creator_supporter_pledges_creator_supporter_fk" FOREIGN KEY ("creator","supporter") REFERENCES "public"."pledges"("creator","supporter") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pledges" ADD CONSTRAINT "pledges_creator_creators_wallet_fk" FOREIGN KEY ("creator") REFERENCES "public"."creators"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contributions_creator_slot_idx" ON "contributions" USING btree ("creator","slot");--> statement-breakpoint
CREATE INDEX "contributions_supporter_slot_idx" ON "contributions" USING btree ("supporter","slot");--> statement-breakpoint
CREATE INDEX "pledges_creator_expires_idx" ON "pledges" USING btree ("creator","expires_at");