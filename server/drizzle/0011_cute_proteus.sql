CREATE TYPE "public"."monitor_status" AS ENUM('up', 'down', 'degraded', 'pending');--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"status" "monitor_status" NOT NULL,
	"response_time_ms" integer,
	"status_code" integer,
	"error_message" text,
	"cert_expiry_days" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"headers" jsonb,
	"body" text,
	"body_encoding" text DEFAULT 'json' NOT NULL,
	"expected_status_codes" jsonb DEFAULT '[200,201,202,203,204,205,206,207,208,226]'::jsonb NOT NULL,
	"interval_seconds" integer DEFAULT 60 NOT NULL,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"retries" integer DEFAULT 3 NOT NULL,
	"retry_interval_seconds" integer DEFAULT 60 NOT NULL,
	"monitor_group" text,
	"cert_expiry_check" boolean DEFAULT true NOT NULL,
	"upside_down_mode" boolean DEFAULT false NOT NULL,
	"max_redirects" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_point_id" uuid,
	"current_status" "monitor_status" DEFAULT 'pending' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"check_count" integer DEFAULT 0 NOT NULL,
	"up_count" integer DEFAULT 0 NOT NULL,
	"consecutive_down" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_contact_point_id_contact_points_id_fk" FOREIGN KEY ("contact_point_id") REFERENCES "public"."contact_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "heartbeats_monitor_idx" ON "heartbeats" USING btree ("monitor_id","checked_at");--> statement-breakpoint
CREATE INDEX "monitors_org_idx" ON "monitors" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "monitors_due_idx" ON "monitors" USING btree ("active","next_check_at");