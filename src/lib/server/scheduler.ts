import cron from 'node-cron';
import { env } from '$env/dynamic/private';
import { enqueueStaleWorkoutProjectionRefreshSweep } from '$lib/server/background-jobs';
import { SignalService } from '$lib/server/services/signal-service';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';
import { DreamService } from '$lib/server/services/dream-service';

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

	console.log('🚀 Starting in-app scheduler...');

	// Daglig check-in kl. 09:00 norsk tid
	// Cron format: sekund minutt time dag måned ukedag
	// '0 9 * * *' = hver dag kl 09:00
	cron.schedule(
		'0 9 * * *',
		async () => {
			console.log('⏰ Running daily check-in at', new Date().toISOString());
			const appUrl = env.ORIGIN || 'https://resonans.vercel.app';
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
			const appUrl = env.ORIGIN || 'https://resonans.vercel.app';
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
			const appUrl = env.ORIGIN || 'https://resonans.vercel.app';
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

	// Drøm-pyramide: hvert nivå leser nivået under, så rekkefølgen av tidspunkter
	// betyr noe (daglig før uke før måned før år).
	cron.schedule(
		'0 3 * * *',
		async () => {
			console.log('🌙 Running daily dream synthesis at', new Date().toISOString());
			try {
				await DreamService.runDailyForAllUsers();
			} catch (err) {
				console.error('❌ runDailyForAllUsers failed:', err);
			}
		},
		{ timezone: 'Europe/Oslo' }
	);

	cron.schedule(
		'0 22 * * 0',
		async () => {
			console.log('🌙 Running weekly dream synthesis at', new Date().toISOString());
			try {
				await DreamService.runWeeklyForAllUsers();
			} catch (err) {
				console.error('❌ runWeeklyForAllUsers failed:', err);
			}
		},
		{ timezone: 'Europe/Oslo' }
	);

	cron.schedule(
		'0 4 1 * *',
		async () => {
			console.log('🌙 Running monthly dream synthesis at', new Date().toISOString());
			try {
				await DreamService.runMonthlyForAllUsers();
			} catch (err) {
				console.error('❌ runMonthlyForAllUsers failed:', err);
			}
		},
		{ timezone: 'Europe/Oslo' }
	);

	cron.schedule(
		'0 5 1 1 *',
		async () => {
			console.log('🌙 Running yearly dream synthesis at', new Date().toISOString());
			try {
				await DreamService.runYearlyForAllUsers();
			} catch (err) {
				console.error('❌ runYearlyForAllUsers failed:', err);
			}
		},
		{ timezone: 'Europe/Oslo' }
	);

	isSchedulerRunning = true;
	console.log('✅ Scheduler started:');
	console.log('   - Daily check-in at 09:00 Europe/Oslo');
	console.log('   - Local nudges + domain signals every hour (UTC scheduler, local-time aware nudges)');
	console.log('   - Egenfrekvens-sjekkin every 5 minutes (UTC scheduler, per-user local time window)');
	console.log('   - Workout projection stale sweeper every 15 minutes (UTC)');
	console.log('   - Daily dream synthesis at 03:00 Europe/Oslo');
	console.log('   - Weekly dream synthesis Sundays at 22:00 Europe/Oslo');
	console.log('   - Monthly dream synthesis 1st of month at 04:00 Europe/Oslo');
	console.log('   - Yearly dream synthesis Jan 1st at 05:00 Europe/Oslo');
}

