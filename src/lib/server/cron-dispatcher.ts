import cron from 'node-cron';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { appOrigin } from '$lib/server/app-origin';
import { pgClient } from '$lib/db';
import { CRON_JOBS } from '$lib/server/cron-jobs';
import { claimDueCronJobs, releaseCronDispatchClaim, type DueCronJob } from '$lib/server/cron-due';
import {
	dispatchTimeoutMs,
	resolveDispatchBaseUrl,
	shouldReleaseClaimOnDispatchError
} from '$lib/server/cron-dispatch-logic';

/**
 * In-app cron-dispatcher: klokka som erstatter GitHub Actions.
 *
 * Tikker hvert minutt, tar dispatch-krav gjennom `claimDueCronJobs` (samme vei
 * som `?due=1`-endepunktet) og self-fetcher jobbenes endepunkter over loopback
 * med `CRON_SECRET`. Hele kjeden nedstrøms er uendret: `denyUnauthorizedCron`,
 * `withCronTracking`, `cron_executions` og monitoreringens «manglende
 * kjøring»-sjekk ser nøyaktig det de så da GitHub Actions var klokka.
 *
 * Lederlåsen er en Postgres advisory-lås på en RESERVERT tilkobling fra
 * poolen — ikke en miljøvariabel-konvensjon. Coolify gjør rullende
 * oppdatering, så det finnes alltid et vindu med to containere: begge kan ha
 * `ENABLE_CRON_DISPATCHER=true`, én vinner låsen, den andre står standby og
 * prøver igjen hvert tick. Dør lederen (SIGTERM lukker poolen), slipper
 * Postgres låsen og standby tar over innen ett minutt. Det fjerner
 * «nøyaktig én instans»-regelen som scheduleren fortsatt lever med.
 *
 * GitHub Actions kan (og skal, i en overgangsperiode) kjøre samtidig:
 * kravtabellen gjør at de to klokkene aldri dobbeltkjører et slot.
 */

export const LEADER_LOCK_NAME = 'resonans-cron-dispatcher';

let isDispatcherRunning = false;
let isLeader = false;
let reserved: Awaited<ReturnType<typeof pgClient.reserve>> | null = null;
const inFlight = new Set<string>();

/**
 * Denne PROSESSENS dispatchertilstand, for statuskortet på /settings/jobs.
 * NB: web-forespørselen kan treffe standby-instansen under en rullende
 * oppdatering — om noen i det hele tatt er leder, svarer pg_locks på
 * (se cron-dispatch-status.ts), ikke dette.
 */
export function cronDispatcherLocalState(): { running: boolean; leader: boolean } {
	return { running: isDispatcherRunning, leader: isLeader };
}

export function startCronDispatcher() {
	if (isDispatcherRunning) {
		console.log('[cron-dispatch] kjører allerede');
		return;
	}

	// Deployet krever boot-checks CRON_SECRET uansett; dette dekker bare dev,
	// der cron-vakta slipper alt gjennom uten konfigurert hemmelighet.
	if (!dev && !env.CRON_SECRET) {
		console.error('[cron-dispatch] startet ikke: CRON_SECRET mangler.');
		return;
	}

	// ORIGIN er lastbærende for loopback-dispatch: nudge-endepunktene bygger
	// lenker av `url.origin`, og adapter-node bruker ORIGIN som base når den er
	// satt (handler.js: `base: origin || get_origin(req.headers)`). Uten den
	// ville hver nudge fått lenker til http://127.0.0.1:3000 — helt stille.
	// Da er det bedre å nekte å starte: GitHub Actions-fallbacken kaller den
	// offentlige adressen og gir riktige lenker. Samme vakt som den gamle
	// scheduleren hadde, av samme grunn.
	if (!dev) {
		try {
			appOrigin();
		} catch (err) {
			console.error(
				'[cron-dispatch] startet ikke: ORIGIN mangler — nudger dispatchet over loopback ' +
					'ville fått lenker til 127.0.0.1.',
				err instanceof Error ? err.message : err
			);
			return;
		}
	}

	const baseUrl = resolveDispatchBaseUrl({
		CRON_DISPATCH_BASE_URL: env.CRON_DISPATCH_BASE_URL,
		PORT: env.PORT
	});
	const workerId = `dispatcher-${process.pid}-${Date.now().toString(36)}`;

	cron.schedule('* * * * *', async () => {
		try {
			await tick(baseUrl, workerId);
		} catch (err) {
			console.error('[cron-dispatch] tick feilet:', err);
		}
	});

	isDispatcherRunning = true;
	console.log(
		`[cron-dispatch] startet: ${CRON_JOBS.length} jobber i registeret, dispatch mot ${baseUrl}, ` +
			'lederlås via pg_try_advisory_lock'
	);
}

async function tick(baseUrl: string, workerId: string) {
	if (!(await ensureLeadership())) return;

	// In-flight-filteret skjer FØR kravtakingen — ellers brennes slotet for en
	// jobb vi uansett ikke dispatcher fordi forrige slot fortsatt kjører.
	const available = CRON_JOBS.filter((job) => !inFlight.has(job.path));
	const due = await claimDueCronJobs({ claimedBy: workerId, jobs: available });
	if (due.length === 0) return;

	console.log(`[cron-dispatch] ${due.length} jobb(er) due: ${due.map((d) => d.job.path).join(', ')}`);
	await Promise.allSettled(due.map((d) => dispatchJob(baseUrl, d)));
}

async function dispatchJob(baseUrl: string, { job, slot }: DueCronJob) {
	inFlight.add(job.path);
	try {
		const headers: Record<string, string> = {};
		if (env.CRON_SECRET) headers.Authorization = `Bearer ${env.CRON_SECRET}`;

		const res = await fetch(`${baseUrl}${job.path}`, {
			headers,
			signal: AbortSignal.timeout(dispatchTimeoutMs(job))
		});
		const body = await res.text();
		if (res.ok) {
			console.log(`[cron-dispatch] ✓ ${job.path} → ${res.status}: ${body.slice(0, 200)}`);
		} else {
			// Jobben nådde serveren og svarte selv — withCronTracking har bokført
			// den. Kravet skal stå: en re-dispatch ville kjørt den én gang til.
			console.error(`[cron-dispatch] ✗ ${job.path} → ${res.status}: ${body.slice(0, 300)}`);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[cron-dispatch] ✗ ${job.path} → ${message}`);
		if (shouldReleaseClaimOnDispatchError(err)) {
			// Nådde aldri serveren: slipp kravet så et senere tick innenfor
			// lookback-vinduet kan prøve slotet på nytt.
			try {
				await releaseCronDispatchClaim(job.path, slot);
				console.log(`[cron-dispatch] slapp kravet for ${job.path} @ ${slot.toISOString()} — prøves igjen`);
			} catch (releaseErr) {
				console.error(`[cron-dispatch] klarte ikke slippe kravet for ${job.path}:`, releaseErr);
			}
		}
	} finally {
		inFlight.delete(job.path);
	}
}

/**
 * Er vi leder? Tar (eller verifiserer) advisory-låsen på den reserverte
 * tilkoblingen. Låsen er sesjonsbundet, så helsesjekken (`select 1`) er
 * hele verifikasjonen: dør tilkoblingen, er låsen sluppet hos Postgres, og
 * vi demoterer oss selv og prøver på nytt fra bunnen neste tick.
 */
async function ensureLeadership(): Promise<boolean> {
	if (isLeader && reserved) {
		try {
			await reserved`select 1`;
			return true;
		} catch (err) {
			console.warn('[cron-dispatch] mistet ledertilkoblingen, prøver på nytt:', err);
			await demote();
		}
	}

	if (!reserved) {
		try {
			reserved = await pgClient.reserve();
		} catch (err) {
			console.error('[cron-dispatch] fikk ikke reservert DB-tilkobling:', err);
			return false;
		}
	}

	try {
		const rows = await reserved`
			select pg_try_advisory_lock(hashtext(${LEADER_LOCK_NAME})::bigint) as locked
		`;
		const locked = rows[0]?.locked === true;
		if (locked && !isLeader) {
			isLeader = true;
			console.log('[cron-dispatch] 🔒 er leder — dispatcher aktiv på denne instansen');
		}
		return locked;
	} catch (err) {
		console.error('[cron-dispatch] lås-forsøk feilet:', err);
		await demote();
		return false;
	}
}

/**
 * Gi opp lederskapet og den reserverte tilkoblingen.
 *
 * `release()` LUKKER ikke sesjonen — den legger tilkoblingen tilbake i poolen.
 * En advisory-lås som fortsatt holdes ville altså levd videre på en
 * pool-tilkobling ingen eier, og ingen instans kunne blitt leder igjen før
 * hele prosessen døde. Derfor slippes låsene eksplisitt først; feiler kallet,
 * er tilkoblingen død og serveren har alt sluppet dem.
 */
async function demote() {
	isLeader = false;
	const r = reserved;
	reserved = null;
	if (!r) return;
	try {
		await r`select pg_advisory_unlock_all()`;
	} catch {
		// Død tilkobling — låsen er alt sluppet hos serveren.
	}
	try {
		r.release();
	} catch {
		// Poenget er at referansen er nullstilt.
	}
}
