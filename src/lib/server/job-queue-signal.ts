import { pgClient } from '$lib/db';

/**
 * NOTIFY-signalet som vekker jobbkø-workeren (`job-worker.ts`).
 *
 * Egen modul (ikke i `background-jobs.ts`) fordi projeksjonskøen også trenger
 * den: `background-jobs` → `workout-projection-service` →
 * `workout-projection-refresh-queue`, så en import tilbake ville lukket en
 * sirkel.
 *
 * Hver skrivevei som gjør en jobb kjørbar NÅ skal kalle `notifyJobQueued()`
 * etterpå — det er det som gjør at køen plukkes opp på sekunder i stedet for
 * ved neste 5-minutters cron-burst. Bare et hint: workeren poller også, så en
 * tapt notify koster latens, aldri en jobb.
 */
export const JOB_QUEUE_CHANNEL = 'background_jobs_queued';

export function notifyJobQueued(): void {
	// Fire-and-forget — se doc-kommentaren over: en tapt notify koster latens.
	void pgClient
		.notify(JOB_QUEUE_CHANNEL, '')
		.catch((err) => console.warn('[job-queue-signal] pg_notify feilet:', err));
}
