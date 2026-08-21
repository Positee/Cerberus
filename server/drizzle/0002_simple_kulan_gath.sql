ALTER TYPE "public"."member_role" ADD VALUE 'viewer';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "members_can_invite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "members_can_create_projects" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "members_can_manage_alerts" boolean DEFAULT false NOT NULL;