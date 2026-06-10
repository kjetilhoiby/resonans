import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

/**
 * GET /api/cron/jobs
 * Returnerer alle registrerte cron-jobber med path og schedule.
 * GitHub Actions-workflowen bruker denne listen til å avgjøre
 * hvilke jobber som skal kjøres hvert 5. minutt.
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
		schedule: '0 0 * * *', // midnatt UTC
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
		path: '/api/cron/spond-sync',
		schedule: '0 2 * * *', // 02:00 UTC = 04:00 Oslo (CEST)
		description: 'Nattlig Spond-synk (alle brukere)',
		maxDurationSeconds: 120
	},
	{
		path: '/api/cron/monitoring',
		schedule: '30 17 * * *', // 17:30 UTC = 19:30 Oslo (CEST)
		description: 'Kveldlig systemhelsesjekk — sensor-ferskhet, jobb-helse, cron-eksekvering → Google Chat',
		maxDurationSeconds: 30
	}
];

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	return json(JOBS);
};
