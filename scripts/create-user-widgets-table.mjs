import { readFileSync } from 'fs';

const env = readFileSync('.env', 'utf8');
const url = env.match(/DATABASE_URL=([^\n]+)/)?.[1]?.trim();

const postgres = (await import('postgres')).default;
const sql = postgres(url);

try {
  await sql`
    CREATE TABLE IF NOT EXISTS "user_widgets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL,
      "title" text NOT NULL,
      "metric_type" text NOT NULL,
      "aggregation" text NOT NULL,
      "period" text NOT NULL,
      "range" text NOT NULL,
      "goal" numeric,
      "unit" text NOT NULL,
      "color" text DEFAULT '#7c8ef5' NOT NULL,
      "pinned" boolean DEFAULT false NOT NULL,
      "sort_order" integer DEFAULT 0 NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `;
  console.log('✅ Tabell opprettet');

  // Add FK only if it doesn't already exist
  const fkExists = await sql`
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_widgets_user_id_users_id_fk'
    AND table_name = 'user_widgets'
  `;
  if (fkExists.length === 0) {
    await sql`
      ALTER TABLE "user_widgets"
      ADD CONSTRAINT "user_widgets_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action
    `;
    console.log('✅ FK-constraint lagt til');
  } else {
    console.log('ℹ️  FK-constraint finnes allerede');
  }

  const result = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'user_widgets'
    ) AS exists
  `;
  console.log('user_widgets finnes:', result[0].exists);
} finally {
  await sql.end();
}
