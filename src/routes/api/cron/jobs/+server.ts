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
		schedule: '0 9 * * *',
		description: 'Daglig check-in melding via Google Chat'
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
		maxDurationSeconds: 120
	}
];

export const GET: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('authorization');
	if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	return json(JOBS);
};
