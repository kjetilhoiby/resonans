CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text,
	"nickname" text,
	"birth_date" date,
	"kind" text DEFAULT 'other' NOT NULL,
	"avatar_emoji" text,
	"notes" text,
	"spond_group_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"email_addresses" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "person_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"from_person_id" uuid,
	"to_person_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"sub_type" text,
	"closeness" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "message_person_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"confidence" text DEFAULT 'inferred' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "task_person_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"confidence" text DEFAULT 'inferred' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "person_relations" ADD CONSTRAINT "person_relations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "person_relations" ADD CONSTRAINT "person_relations_from_person_id_persons_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "person_relations" ADD CONSTRAINT "person_relations_to_person_id_persons_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "message_person_mentions" ADD CONSTRAINT "message_person_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_person_mentions" ADD CONSTRAINT "message_person_mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "message_person_mentions" ADD CONSTRAINT "message_person_mentions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "task_person_mentions" ADD CONSTRAINT "task_person_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "task_person_mentions" ADD CONSTRAINT "task_person_mentions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "task_person_mentions" ADD CONSTRAINT "task_person_mentions_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "persons_user_kind_idx" ON "persons" USING btree ("user_id","kind");
CREATE INDEX "persons_user_active_idx" ON "persons" USING btree ("user_id","archived");

CREATE UNIQUE INDEX "person_relations_user_from_to_subtype_unique" ON "person_relations" USING btree ("user_id","from_person_id","to_person_id","sub_type");
CREATE INDEX "person_relations_from_idx" ON "person_relations" USING btree ("from_person_id");
CREATE INDEX "person_relations_to_idx" ON "person_relations" USING btree ("to_person_id");
CREATE INDEX "person_relations_user_type_idx" ON "person_relations" USING btree ("user_id","relation_type");

CREATE UNIQUE INDEX "message_person_mentions_msg_person_unique" ON "message_person_mentions" USING btree ("message_id","person_id");
CREATE INDEX "message_person_mentions_person_created_idx" ON "message_person_mentions" USING btree ("person_id","created_at");
CREATE INDEX "message_person_mentions_user_created_idx" ON "message_person_mentions" USING btree ("user_id","created_at");

CREATE UNIQUE INDEX "task_person_mentions_task_person_unique" ON "task_person_mentions" USING btree ("task_id","person_id");
CREATE INDEX "task_person_mentions_person_created_idx" ON "task_person_mentions" USING btree ("person_id","created_at");
