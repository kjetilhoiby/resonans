import cron from 'node-cron';
import { appOrigin } from '$lib/server/app-origin';
import { enqueueStaleWorkoutProjectionRefreshSweep } from '$lib/server/background-jobs';
import { SignalService } from '$lib/server/services/signal-service';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';

/**
 * In-app cron scheduler using node-cron
 * Kjører direkte i applikasjonsserveren - ingen Vercel Cron plan nødvendig!
 */

let isSchedulerRunning = false;

export function startScheduler() {
	if (isSchedulerRunning) {
		console.log('⏰ Scheduler already running');
		return;
	}

	// Adressen leses ÉN gang, og en manglende ORIGIN stopper scheduleren framfor
	// å la den kjøre. Alle jobbene her sender nudger med lenker; en scheduler som
	// peker på feil domene er verre enn ingen scheduler, fordi den ser ut til å
	// virke. Se app-origin.ts.
	let appUrl: string;
	try {
		appUrl = appOrigin();
	} catch (err) {
		console.error('❌ Scheduler startet ikke:', err instanceof Error ? err.message : err);
		return;
	}

	console.log('🚀 Starting in-app scheduler...');

	// Daglig check-in kl. 09:00 norsk tid
	// Cron format: sekund minutt time dag måned ukedag
	// '0 9 * * *' = hver dag kl 09:00
	cron.schedule(
		'0 9 * * *',
		async () => {
			console.log('⏰ Running daily check-in at', new Date().toISOString());
			await NudgeOrchestrationService.runDailyCheckInNudges({
				appUrl,
				requireRecentTimeWindow: false
			});
		},
		{
			timezone: 'Europe/Oslo' // Norsk tidssone
		}
	);

	// Kjører hver hele time og sender lokale nudges (planlegg dag, parsjekk morgen, avslutt dag).
	cron.schedule(
		'0 * * * *',
		async () => {
			console.log('⏰ Running local nudges (day planning/relationship/day close) at', new Date().toISOString());
			try {
				await NudgeOrchestrationService.runScheduledNudges(appUrl);
			} catch (err) {
				console.error('❌ runScheduledNudges failed:', err);
			}
			try {
				await SignalService.runProducers();
			} catch (err) {
				console.error('❌ runDomainSignalProducers failed:', err);
			}
		},
		{
			timezone: 'UTC'
		}
	);

	// Egenfrekvens-sjekkin: kjører hvert 5. minutt og treffer brukere innenfor sitt valgte tidspunkt.
	cron.schedule(
		'*/5 * * * *',
		async () => {
			try {
				await NudgeOrchestrationService.runEgenfrekvensCheckInNudges({
					appUrl,
					windowMinutes: 5,
					requireRecentTimeWindow: true
				});
			} catch (err) {
				console.error('❌ runEgenfrekvensCheckInNudges failed:', err);
			}
			try {
				await NudgeOrchestrationService.runProgramReadinessNudges({
					appUrl,
					windowMinutes: 5,
					requireRecentTimeWindow: true
				});
			} catch (err) {
				console.error('❌ runProgramReadinessNudges failed:', err);
			}
		},
		{
			timezone: 'UTC'
		}
	);

	// Stale-sweeper for workout projections every 15 minutes.
	cron.schedule(
		'*/15 * * * *',
		async () => {
			console.log('⏰ Running workout projection stale sweeper at', new Date().toISOString());
			try {
				await enqueueStaleWorkoutProjectionRefreshSweep({ maxAgeMs: 15 * 60 * 1000, limit: 200 });
			} catch (err) {
				console.error('❌ enqueueStaleWorkoutProjectionRefreshSweep failed:', err);
			}
		},
		{
			timezone: 'UTC'
		}
	);

	// Withings-synk og nattlig aggregering håndteres av GitHub Actions cron
	// via /api/cron/withings-sync og /api/cron/aggregate (se /api/cron/jobs).

	// Drøm-pyramiden trigges nå via GitHub Actions → /api/cron/dreams (se
	// /api/cron/jobs), siden in-app node-cron ikke kjører på Vercel serverless.

	isSchedulerRunning = true;
	console.log('✅ Scheduler started:');
	console.log('   - Daily check-in at 09:00 Europe/Oslo');
	console.log('   - Local nudges + domain signals every hour (UTC scheduler, local-time aware nudges)');
	console.log('   - Egenfrekvens-sjekkin every 5 minutes (UTC scheduler, per-user local time window)');
	console.log('   - Workout projection stale sweeper every 15 minutes (UTC)');
	console.log('   - Dream synthesis via GitHub Actions cron (/api/cron/dreams)');
}

