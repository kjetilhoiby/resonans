import { dbDriver, pgClient } from '$lib/db';
import { processDueBackgroundJobs } from '$lib/server/background-jobs';
import { JOB_QUEUE_CHANNEL } from '$lib/server/job-queue-signal';

/**
 * Jobbkø-worker: LISTEN/NOTIFY + polling over `background_jobs`.
 *
 * Fram til september 2026 ble køen bare tømt av `/api/cron/background-jobs`
 * hvert 5. minutt — et serverless-formet valg (ingen prosess å ha en løkke i).
 * På VPS-en lytter workeren på `pg_notify` fra skriveveiene
 * (`notifyJobQueued` i job-queue-signal.ts), så en jobb plukkes opp på
 * sekunder. Pollen hvert 30. sekund er sikkerhetsnettet: den fanger tapte
 * notifies, jobber med `runAt` i framtida (retry-backoff), og krasjede
 * kjøringer (`recoverStaleRunningJobs` kjøres i hver batch).
 *
 * INGEN lederlås, med vilje: `claimNextDueJob` bruker
 * `FOR UPDATE SKIP LOCKED`, så to instanser deler køen trygt — i motsetning
 * til cron-dispatcheren, der selve klokka må være én. Cron-bursten i
 * registeret beholdes som fallback (og er fortsatt veien på Vercel).
 */

const POLL_INTERVAL_MS = 30_000;
const BATCH_LIMIT = 25;

let isWorkerRunning = false;
let processing = false;
let runRequestedWhileBusy = false;

export function startJobWorker() {
	if (isWorkerRunning) {
		console.log('[job-worker] kjører allerede');
		return;
	}

	// LISTEN krever en dedikert TCP-sesjon; neon-http har ingen. Der er
	// cron-bursten fortsatt veien, så dette er feil flagg, ikke en feil.
	if (dbDriver !== 'postgres') {
		console.error(
			`[job-worker] startet ikke: krever DB-driveren 'postgres' (er '${dbDriver}'). ` +
				'På Vercel/neon-http tømmes køen av /api/cron/background-jobs.'
		);
		return;
	}

	isWorkerRunning = true;
	const workerId = `worker-${process.pid}-${Date.now().toString(36)}`;

	// postgres-js holder lytte-tilkoblingen selv og re-subscriber ved brudd.
	// Feiler selve oppsettet, lever workeren videre på pollen alene.
	void pgClient
		.listen(JOB_QUEUE_CHANNEL, () => {
			void drainQueue(workerId);
		})
		.catch((err) => {
			console.error('[job-worker] LISTEN feilet — faller tilbake til ren polling:', err);
		});

	const timer = setInterval(() => {
		void drainQueue(workerId);
	}, POLL_INTERVAL_MS);
	timer.unref?.();

	console.log(
		`[job-worker] startet: LISTEN på '${JOB_QUEUE_CHANNEL}' + poll hvert ${POLL_INTERVAL_MS / 1000}. sekund`
	);

	// Ta det som alt ligger i køen ved oppstart (f.eks. enqueuet mens forrige
	// container var på vei ned).
	void drainQueue(workerId);
}

/**
 * Serialisert tømming: én kjøring av gangen i prosessen. En notify som lander
 * midt i en kjøring settes som flagg og tas umiddelbart etterpå — mister vi
 * den, står jobben uansett ikke lenger enn til neste poll.
 */
async function drainQueue(workerId: string) {
	if (processing) {
		runRequestedWhileBusy = true;
		return;
	}
	processing = true;
	try {
		do {
			runRequestedWhileBusy = false;
			let processed = 0;
			do {
				const result = await processDueBackgroundJobs({ limit: BATCH_LIMIT, workerId });
				processed = result.processed;
				if (processed > 0) {
					console.log(
						`[job-worker] ${processed} jobb(er): ${result.completed} ok, ${result.failed} feilet, ${result.retried} retry`
					);
				}
			} while (processed === BATCH_LIMIT);
		} while (runRequestedWhileBusy);
	} catch (err) {
		console.error('[job-worker] prosessering feilet:', err);
	} finally {
		processing = false;
	}
}
