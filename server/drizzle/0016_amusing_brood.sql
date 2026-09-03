CREATE TYPE "public"."knowledge_resource_type" AS ENUM('article', 'video');--> statement-breakpoint
CREATE TYPE "public"."knowledge_topic" AS ENUM('foundations', 'networking', 'identity', 'defense');--> statement-breakpoint
CREATE TABLE "knowledge_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_key" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"topic" "knowledge_topic" NOT NULL,
	"type" "knowledge_resource_type" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"source_url" text,
	"duration_minutes" integer DEFAULT 5 NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_progress" ADD CONSTRAINT "knowledge_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_progress" ADD CONSTRAINT "knowledge_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_resources" ADD CONSTRAINT "knowledge_resources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_resources" ADD CONSTRAINT "knowledge_resources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_progress_key" ON "knowledge_progress" USING btree ("organization_id","user_id","lesson_key");--> statement-breakpoint
CREATE INDEX "knowledge_progress_user_idx" ON "knowledge_progress" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "knowledge_resources_org_idx" ON "knowledge_resources" USING btree ("organization_id","topic","created_at");