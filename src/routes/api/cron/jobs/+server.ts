import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { cronExecutions } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import { isDue } from '$lib/server/cron-schedule';
import type { RequestHandler } from './$types';

/**
 * GET /api/cron/jobs
 * Returnerer alle registrerte cron-jobber med path og schedule.
 *
 * GET /api/cron/jobs?due=1
 * Returnerer kun jobbene som skal kjøre nå (beregnet server-side mot
 * `cron_executions` for å unngå dobbeltkjøring). GitHub Actions-workflowen
 * bruker dette slik at en forsinket dispatch fortsatt fanger daglige jobber.
 *
 * Legg til nye cron-jobber her — ingen endringer nødvendig i workflow.
 */

export type CronJob = {
	path: string;
	schedule: string; // standard 5-felt cron-uttrykk (UTC)
	description: string;
	maxDurationSeconds?: number;
};

const JOBS: CronJob[] = [
	{
		path: '/api/cron/aggregate',
		schedule: '0 3 * * *', // 03:00 UTC = 05:00 Oslo — unna det overbelastede midnatt-UTC-slotet
		description: 'Nattlig aggregering — ukentlig/månedlig/årlig (alle brukere)',
		maxDurationSeconds: 300
	},
	{
		path: '/api/cron/daily-checkin',
		schedule: '*/5 * * * *',
		description: 'Daglig check-in melding via Google Chat (lokal tid per bruker, 5-min vindu)'
	},
	{
		path: '/api/cron/rescuetime-sync',
		schedule: '40 4,12,20 * * *', // tre ganger daglig — morgensync fanger hele gårsdagen
		description: 'RescueTime PC-aktivitet — siste 3 dager per bruker (upsert per dag)',
		maxDurationSeconds: 60
	},
	{
		path: '/api/cron/day-planning-nudges',
		schedule: '0 * * * *',
		description: 'Timebasert lokal nudge for planlegg dag (07:00), parsjekk morgen (08:30) og avslutt dag (21:00)'
	},
	{
		path: '/api/cron/domain-signals',
		schedule: '15 * * * *',
		description: 'Produserer avledede cross-domain signaler for temaer og domene-kontrakter',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/sparebank1-sync',
		schedule: '0 */6 * * *', // hver 6. time
		description: 'SpareBank 1 inkrementell synk (alle brukere)',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/withings-sync',
		schedule: '*/5 5-22 * * *', // hvert 5. minutt mellom 05:00–22:00 UTC
		description: 'Withings sensordata synk (alle brukere)',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/dropbox-sync',
		schedule: '*/5 * * * *', // hvert 5. minutt
		description: 'Dropbox TCX/GPX import (alle brukere)',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/background-jobs',
		schedule: '*/5 * * * *', // hvert 5. minutt
		description: 'Prosesserer intern databasedrevet jobbkø',
		maxDurationSeconds: 300
	},
	{
		path: '/api/cron/salary-nudge',
		schedule: '30 */6 * * *', // 30 min etter sparebank1-sync
		description: 'Sender lønn-mottatt-nudge for brukere med ny lønnsinngang siste 3 dager',
		maxDurationSeconds: 120
	},
	{
		path: '/api/notifications/egenfrekvens-checkin',
		schedule: '*/5 * * * *',
		description: 'Egenfrekvens daglig sjekkin-nudge (lokal tid per bruker, 5-min vindu)',
		maxDurationSeconds: 60
	},
	{
		path: '/api/notifications/livskompasset-weekend',
		schedule: '*/15 * * * 6', // lørdag UTC, hvert 15. min — per-bruker lørdag-i-tz + 15-min vindu
		description: 'Livskompasset ukentlig helge-nudge (lørdag morgen, lokal tid per bruker)',
		maxDurationSeconds: 60
	},
	{
		path: '/api/cron/spond-sync',
		schedule: '0 2 * * *', // 02:00 UTC = 04:00 Oslo (CEST)
		description: 'Nattlig Spond-synk (alle brukere)',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/tesla-sync',
		schedule: '*/15 5-22 * * *', // hvert 15. minutt 05:00–22:00 UTC — konservativt for ikke å holde bilen våken
		description: 'Tesla vehicle_data synk (alle brukere) — batteri/posisjon/km-stand',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/adaptive-training',
		schedule: '0 18 * * 0', // søndag 18:00 UTC = 20:00 Oslo (CEST)
		description: 'Ukentlig justering av adaptive treningsprogrammer — tempo, dagplassering og volum for neste uke',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/monitoring',
		schedule: '30 17 * * *', // 17:30 UTC = 19:30 Oslo (CEST)
		description: 'Kveldlig systemhelsesjekk — sensor-ferskhet, jobb-helse, cron-eksekvering → Google Chat',
		maxDurationSeconds: 30
	},
	// Drøm-pyramide: hvert nivå leser nivået under, så tidspunktene er adskilte
	// og staggered (en time mellom) slik at de aldri dispatches i samme tick —
	// rekkefølgen dag → uke → måned → år holdes selv 1. januar.
	{
		path: '/api/cron/dreams?level=daily',
		schedule: '0 1 * * *', // 01:00 UTC = 03:00 Oslo (CEST)
		description: 'Daglig drøm-syntese (alle brukere) — leser refleksjoner + plan-artefakter + egenfrekvens',
		maxDurationSeconds: 300
	},
	{
		path: '/api/cron/dreams?level=weekly',
		schedule: '0 20 * * 0', // søndag 20:00 UTC = 22:00 Oslo (CEST), slutten av ISO-uka
		description: 'Ukentlig drøm-syntese (alle brukere) — leser ukens daglige drømmer',
		maxDurationSeconds: 300
	},
	{
		path: '/api/cron/dreams?level=monthly',
		schedule: '0 2 1 * *', // 1. i mnd 02:00 UTC = 04:00 Oslo (CEST)
		description: 'Månedlig drøm-syntese (alle brukere) — leser forrige måneds ukentlige drømmer',
		maxDurationSeconds: 300
	},
	{
		path: '/api/cron/dreams?level=yearly',
		schedule: '0 3 1 1 *', // 1. jan 03:00 UTC = 05:00 Oslo (CEST)
		description: 'Årlig drøm-syntese (alle brukere) — leser fjorårets månedlige drømmer',
		maxDurationSeconds: 300
	}
];

export const GET: RequestHandler = async ({ request, url }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (url.searchParams.get('due') !== '1') {
		return json(JOBS);
	}

	// Siste faktiske kjøring per jobb (uavhengig av status) for dedup.
	const lastRunRows = await db
		.select({
			jobPath: cronExecutions.jobPath,
			lastRunAt: sql<string>`max(${cronExecutions.executedAt})`
		})
		.from(cronExecutions)
		.groupBy(cronExecutions.jobPath);

	const lastRunByPath = new Map<string, Date>();
	for (const row of lastRunRows) {
		if (row.lastRunAt) lastRunByPath.set(row.jobPath, new Date(row.lastRunAt));
	}

	const now = new Date();
	const due = JOBS.filter((job) => isDue(job.schedule, now, lastRunByPath.get(job.path) ?? null));

	return json(due);
};
