CREATE TYPE "public"."billing_period" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'pro', 'enterprise');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan" "plan_tier" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_period" "billing_period" DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_since" timestamp with time zone DEFAULT now() NOT NULL;