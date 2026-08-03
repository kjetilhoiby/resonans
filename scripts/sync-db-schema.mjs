#!/usr/bin/env node
/**
 * Synkroniserer Drizzle-skjemaet (src/lib/db/schema.ts) mot live-DB-en, og
 * kjører idempotente data-migreringer som må følge med kode-endringer.
 *
 * Kjøres som en del av Vercel build (se vercel.json) slik at endringer i
 * schema.ts blir applisert automatisk ved deploy — uten å måtte kjøre
 * `npm run db:push` eller standalone migration-scripts manuelt.
 *
 * Deploy-flow:
 *   1. apply-sql-migrations.mjs — eksplisitte SQL-migrasjoner
 *      (table/column rename, drop column, typeendringer) som drizzle-kit
 *      push ikke håndterer trygt. Tracked via `_sql_migrations`-tabellen.
 *   2. drizzle-kit push --force — additive endringer (CREATE TABLE,
 *      ADD COLUMN med default, ADD INDEX) som drizzle gjenkjenner trygt.
 *   3. Idempotente data-migreringer (UPDATE/INSERT) som må følge kode.
 *
 * Sikkerhetsnett:
 *   - Hopper over alt utenom VERCEL_ENV=production (preview-deploys får ikke
 *     trash prod-DB-en).
 *   - SKIP_DB_SYNC=1 lar deg deakt­ivere uten å fjerne hooken.
 *   - SKIP_SQL_MIGRATIONS=1 hopper kun over SQL-runner-steget.
 *   - Krever DATABASE_URL (Vercel setter denne).
 *
 * Lokalt: bruk `npm run db:sync` (eller `npm run db:push`).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

const vercelEnv = process.env.VERCEL_ENV;
const isVercel = Boolean(process.env.VERCEL);

if (process.env.SKIP_DB_SYNC === '1') {
	console.log('[db:sync] SKIP_DB_SYNC=1 — hopper over.');
	process.exit(0);
}

if (isVercel && vercelEnv !== 'production') {
	console.log(`[db:sync] VERCEL_ENV=${vercelEnv ?? '<unset>'} — hopper over (kun production).`);
	process.exit(0);
}

if (!process.env.DATABASE_URL) {
	console.error('[db:sync] DATABASE_URL er ikke satt — avbryter.');
	process.exit(1);
}

console.log('[db:sync] Steg 1/2 — kjører eksplisitte SQL-migrasjoner …');
const migrationsResult = spawnSync('node', [join(__dirname, 'apply-sql-migrations.mjs')], {
	stdio: 'inherit',
	env: process.env
});

if (migrationsResult.status !== 0) {
	console.error(`[db:sync] apply-sql-migrations.mjs feilet med exit-kode ${migrationsResult.status}.`);
	process.exit(migrationsResult.status ?? 1);
}

console.log('[db:sync] Steg 2/2 — kjører drizzle-kit push --force (best-effort) …');
// drizzle-kit push spør interaktivt om nye tabeller er rename av eksisterende,
// selv med --force, og crasher på CI uten TTY (sett som "Error: Interactive
// prompts require a TTY terminal"). Vi skipper det med exit-code non-fatal.
const result = spawnSync('npx', ['drizzle-kit', 'push', '--force'], {
	stdio: 'inherit',
	env: process.env
});

if (result.status !== 0) {
	// SQL-migrasjonene er autoritative (se CLAUDE.md). drizzle push er bare
	// et sikkerhetsnett for endringer i schema.ts som ikke har fått en
	// SQL-migrasjon ennå. Hvis push feiler — f.eks. fordi den tolker en
	// kolonne som usikker å endre — så logger vi det og fortsetter. Build
	// skal ikke ryke på denne grunn.
	console.warn(`[db:sync] drizzle-kit push exited ${result.status} — fortsetter likevel (SQL-migrasjoner er autoritative).`);
} else {
	console.log('[db:sync] drizzle push OK.');
}

console.log('[db:sync] Skjema synkronisert.');

// ────────────────────────────────────────────────────────────────────────
// Post-sync data-migreringer
//
// Idempotente UPDATE/INSERT-statements som må følge kode-endringer. Hver
// statement skal være trygg å kjøre flere ganger (bruk WHERE-klausuler eller
// ON CONFLICT). Slettes når de er kjørt på prod og ikke lenger har effekt.
// ────────────────────────────────────────────────────────────────────────

const DATA_MIGRATIONS = [
	// 2026-08: Bryt selvløkker i temahierarkiet. parentTheme er fritekst mot
	// forelderens navn, så basen kunne ikke hindre at et tema pekte på seg selv —
	// og prod hadde Helse med parentTheme='Helse'. Tittelen på temasiden ER
	// tilbakeknappen, så den pekte til samme side: trykket gjorde ingenting.
	// Idempotent, og treffer bare rader som faktisk er sirkulære.
	`UPDATE "themes" SET "parent_theme" = NULL WHERE "parent_theme" = "name"`,
	// 2026-05: Omdøp domain 'egenfrekvens' → 'self' (paraply-domene)
	`UPDATE "projects" SET "domain" = 'self' WHERE "domain" = 'egenfrekvens'`,
	`UPDATE "procedures" SET "domain" = 'self' WHERE "domain" = 'egenfrekvens'`,
	// 2026-06: Plater prises i pris/m² i stedet for pris/plate. Konverter
	// eksisterende plate-materialer: pricePerSquareMeterNok = pricePerSheetNok /
	// plateareal (m²), og fjern pricePerSheetNok. Idempotent (kun rader som
	// fortsatt har en plate med pricePerSheetNok).
	`UPDATE cut_lists c
	 SET materials = sub.new_materials
	 FROM (
	   SELECT cl.id,
	     jsonb_agg(
	       CASE
	         WHEN (m->>'kind') = 'sheet' AND (m ? 'pricePerSheetNok')
	         THEN (m - 'pricePerSheetNok') || jsonb_build_object(
	           'pricePerSquareMeterNok',
	           round(
	             (m->>'pricePerSheetNok')::numeric
	             / NULLIF(
	                 (COALESCE((m->>'stockWidthMm')::numeric, 2440) / 1000)
	                 * (COALESCE((m->>'stockHeightMm')::numeric, 1220) / 1000),
	               0),
	             2)
	         )
	         ELSE m
	       END
	       ORDER BY ord
	     ) AS new_materials
	   FROM cut_lists cl, jsonb_array_elements(cl.materials) WITH ORDINALITY AS t(m, ord)
	   GROUP BY cl.id
	 ) sub
	 WHERE c.id = sub.id
	   AND EXISTS (
	     SELECT 1 FROM jsonb_array_elements(c.materials) e
	     WHERE (e->>'kind') = 'sheet' AND (e ? 'pricePerSheetNok')
	   )`,
	// 2026-07: Oppgaver med frekvens satt ved opprettelse (f.eks. ukeplan-oppgaver
	// med frequency='weekly') skal ikke stå som «Trenger avklaring» når teksten
	// mangler eksplisitt frekvens — de betyr «1 gang i perioden». Speiler
	// buildDefaultIntentFromTask i task-intent-parser.ts for rader som allerede
	// var markert failed. Idempotent (intentStatus blir 'parsed').
	`UPDATE tasks
	 SET target_value = COALESCE(target_value, 1),
	     unit = COALESCE(NULLIF(unit, ''), 'ganger'),
	     metadata = metadata || jsonb_build_object(
	       'intentStatus', 'parsed',
	       'intentError', null,
	       'intentParser', 'default'
	     ),
	     updated_at = NOW()
	 WHERE frequency IN ('daily', 'weekly', 'monthly', 'once')
	   AND metadata->>'intentStatus' = 'failed'`,
	// 2026-07: Treningsløp (training_plans/tracks) avløser training_programs.
	// Aktive/pausede legacy-programmer arkiveres — adaptive-cron og
	// readiness-precompute no-oper seg selv. Idempotent.
	`UPDATE training_programs
	 SET status = 'archived', updated_at = NOW()
	 WHERE status IN ('active', 'paused')`,
	// 2026-07: Løpedager læres nå av faktisk atferd — nullstill auto-seedede
	// ukedagsmønstre fra første versjon (identifiseres ved 'styrke'-dager, som
	// ikke lenger finnes i manuelle overstyringer). Idempotent.
	`UPDATE training_plans
	 SET schedule = NULL, updated_at = NOW()
	 WHERE schedule->'days'->>'1' = 'styrke'`,
	// 2026-07: ukes_km-milepælene ble feilkrysset av den gamle eqKm-logikken
	// (sykkel talte som løpe-km). Omdøp metrikken til ukes_lop_km OG nullstill
	// kryssene i samme operasjon — etter første kjøring matcher ingen rader
	// lenger (engangs-reset, idempotent).
	`UPDATE track_milestones
	 SET criteria = jsonb_set(criteria, '{metric}', '"ukes_lop_km"'),
	     achieved_at = NULL, sensor_event_id = NULL, updated_at = NOW()
	 WHERE criteria->>'metric' = 'ukes_km'`,
	// 2026-07: km-milepæler krysset FØR pace-filteret (gangfart-registreringer
	// talte som løpe-km) nullstilles. Kryss satt etter cutoff er beregnet med
	// riktig logikk og røres ikke — idempotent fordi re-merking alltid skjer
	// etter cutoff.
	`UPDATE track_milestones
	 SET achieved_at = NULL, sensor_event_id = NULL, updated_at = NOW()
	 WHERE criteria->>'metric' = 'ukes_lop_km'
	   AND achieved_at IS NOT NULL
	   AND achieved_at < TIMESTAMP '2026-07-07 00:00:00'`,
	// 2026-07 (matplan): Oda-kvitteringer parses nå strukturert. Opprett
	// e-postregel for brukere som ikke har en oda_receipt-regel fra før —
	// labelen 'resonans/oda' polles allerede av Gmail Apps Script. Idempotent.
	`INSERT INTO email_rules (user_id, name, label_pattern, sender_pattern, processing_type, event_type, data_type, is_active)
	 SELECT u.id, 'Oda-kvitteringer', 'resonans/oda', '*oda.com*', 'oda_receipt', 'grocery_receipt', 'grocery_order', true
	 FROM users u
	 WHERE NOT EXISTS (
	   SELECT 1 FROM email_rules r
	   WHERE r.user_id = u.id AND r.processing_type = 'oda_receipt'
	 )`,
	// 2026-07: Withings feilstempler av og til langsom gange (bratt terreng, mye
	// høydemeter → lav luftlinjefart) som sykkel/el-sykkel. Etterlikner
	// plausibleSportType() i withings-sync.ts på lagrede økter: sykkel-familien med
	// snittfart under ~7 km/t (1,95 m/s) reklassifiseres til gange. Idempotent —
	// etter kjøring er sportType='walking' og matcher ikke lenger. canonical_workouts
	// er en avledet projeksjon (soft/hard-stale 2/15 min) og rebygges automatisk fra
	// de korrigerte sensor_events ved neste lesing.
	`UPDATE sensor_events
	 SET data = jsonb_set(data, '{sportType}', '"walking"')
	 WHERE metadata->>'source' = 'withings_sync_workout'
	   AND data->>'sportType' IN ('cycling', 'e_bike')
	   AND jsonb_typeof(data->'distance') = 'number'
	   AND jsonb_typeof(data->'duration') = 'number'
	   AND (data->>'distance')::numeric >= 500
	   AND (data->>'duration')::numeric > 0
	   AND (data->>'distance')::numeric / (data->>'duration')::numeric < 1.95`,
	// 2026-08: Helse er blitt et mortema. Eksisterende toppnivå-temaer med et
	// undertema-navn re-foreldres — men bare når brukeren faktisk har et
	// Helse-tema, og bare når de ikke allerede ligger under noe annet
	// (parent_theme IS NULL). Vi stjeler ikke et tema brukeren har plassert
	// bevisst. Idempotent: etter første kjøring matcher ingen rader.
	`UPDATE themes t
	 SET parent_theme = 'Helse', updated_at = NOW()
	 WHERE t.name IN ('Trening', 'Ernæring', 'Egenfrekvens', 'Søvn', 'Skjermtid')
	   AND t.parent_theme IS NULL
	   AND EXISTS (
	     SELECT 1 FROM themes p
	     WHERE p.user_id = t.user_id AND p.name = 'Helse' AND p.archived = false
	   )`,
	// 2026-08: Helse-widgetene ble seedet på mortemaet. Flytt dem til
	// undertemaet som nå viser metrikken, ellers blir søvn-widgeten liggende på
	// mor mens søvnvisningen er på barnet. Kun widgets som fortsatt peker på
	// Helse flyttes — idempotent.
	`UPDATE user_widgets w
	 SET theme_id = child.id, updated_at = NOW()
	 FROM themes parent, themes child
	 WHERE w.theme_id = parent.id
	   AND parent.user_id = w.user_id AND parent.name = 'Helse'
	   AND child.user_id = w.user_id AND child.parent_theme = 'Helse'
	   AND child.name = CASE
	     WHEN w.metric_type IN ('sleepDuration', 'sleepHeartRate') THEN 'Søvn'
	     WHEN w.metric_type IN ('distance', 'activeMinutes', 'steps') THEN 'Trening'
	     WHEN w.metric_type = 'screenTime' THEN 'Skjermtid'
	   END`
];

if (DATA_MIGRATIONS.length > 0) {
	console.log(`[db:sync] Kjører ${DATA_MIGRATIONS.length} data-migrering(er) …`);
	const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: 'require' });
	try {
		for (const stmt of DATA_MIGRATIONS) {
			const res = await sql.unsafe(stmt);
			console.log(`  → ${stmt}  (${res.count} row(s))`);
		}
		console.log('[db:sync] Data-migreringer fullført.');
	} catch (err) {
		console.error('[db:sync] Data-migrering feilet:', err);
		process.exit(1);
	} finally {
		await sql.end();
	}
}
