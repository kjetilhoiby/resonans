-- 0042_projects_home_domain.sql
-- Generell projects-tabell (domen-agnostisk) + projectId-koblinger på tasks,
-- checklist_items og categorized_events. Utvider tasks med season og
-- recurrence_yearly. Gjør tasks.goal_id valgfri.

CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain" text,
	"theme_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"type" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"budget_nok" integer,
	"started_at" timestamp,
	"target_completion_at" timestamp,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "projects" ADD CONSTRAINT "projects_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");
CREATE INDEX "projects_domain_idx" ON "projects" USING btree ("user_id","domain");
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");
CREATE INDEX "projects_theme_idx" ON "projects" USING btree ("theme_id");

-- tasks: gjør goal_id valgfri, legg til project_id, season, recurrence_yearly
ALTER TABLE "tasks" ALTER COLUMN "goal_id" DROP NOT NULL;
ALTER TABLE "tasks" ADD COLUMN "project_id" uuid REFERENCES "public"."projects"("id") ON DELETE set null;
ALTER TABLE "tasks" ADD COLUMN "season" text;
ALTER TABLE "tasks" ADD COLUMN "recurrence_yearly" boolean DEFAULT false NOT NULL;

CREATE INDEX "tasks_project_idx" ON "tasks" USING btree ("project_id");
CREATE INDEX "tasks_season_idx" ON "tasks" USING btree ("season");

-- checklist_items: legg til project_id
ALTER TABLE "checklist_items" ADD COLUMN "project_id" uuid REFERENCES "public"."projects"("id") ON DELETE set null;
CREATE INDEX "checklist_items_project_idx" ON "checklist_items" USING btree ("project_id");

-- categorized_events: legg til project_id
ALTER TABLE "categorized_events" ADD COLUMN "project_id" uuid REFERENCES "public"."projects"("id") ON DELETE set null;
CREATE INDEX "categorized_events_user_project_timestamp_idx" ON "categorized_events" USING btree ("user_id","project_id","timestamp");
