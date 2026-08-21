CREATE TYPE "public"."announcement_audience" AS ENUM('all', 'personal', 'organization');--> statement-breakpoint
CREATE TYPE "public"."announcement_kind" AS ENUM('update', 'promotion', 'notice');--> statement-breakpoint
CREATE TABLE "announcement_reads" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "announcement_kind" DEFAULT 'update' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"audience" "announcement_audience" DEFAULT 'all' NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_reads_key" ON "announcement_reads" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE INDEX "announcement_reads_user_idx" ON "announcement_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announcements_published_idx" ON "announcements" USING btree ("published_at");