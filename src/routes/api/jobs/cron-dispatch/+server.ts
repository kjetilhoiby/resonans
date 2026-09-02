import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { loadCronDispatchStatus } from '$lib/server/cron-dispatch-status';
import { resolveDispatchBaseUrl } from '$lib/server/cron-dispatch-logic';

/**
 * Status og test for cron-dispatcheren — brukes av kortet på /settings/jobs.
 *
 * NB: Ligger bevisst under /api/jobs/, IKKE /api/cron-dispatch: `/api/cron` er
 * PREFIKSMATCH i public-paths.ts, så alt som begynner på den strengen slipper
 * forbi session-auth (samme felle som /api/health historisk). Her skal det
 * være normal innlogget auth.
 *
 * GET  → status: lederlås (pg_locks), kravfordeling siste døgn, siste krav og
 *        kjøringer, med en dom i ord.
 * POST → test: self-fetcher GET /api/cron/jobs over NØYAKTIG samme vei som
 *        dispatcheren bruker (loopback-base + Bearer CRON_SECRET). Ingen jobb
 *        kjøres — registerlista er bivirkningsfri — men loopback, hemmelighet
 *        og cron-vakt testes ende til ende.
 */

export const GET: RequestHandler = async () => {
	const status = await loadCronDispatchStatus();
	return json({ success: true, status });
};

export const POST: RequestHandler = async () => {
	const baseUrl = resolveDispatchBaseUrl({
		CRON_DISPATCH_BASE_URL: env.CRON_DISPATCH_BASE_URL,
		PORT: env.PORT
	});

	const headers: Record<string, string> = {};
	if (env.CRON_SECRET) headers.Authorization = `Bearer ${env.CRON_SECRET}`;

	const started = Date.now();
	try {
		const res = await fetch(`${baseUrl}/api/cron/jobs`, {
			headers,
			signal: AbortSignal.timeout(10_000)
		});
		const latencyMs = Date.now() - started;

		if (!res.ok) {
			const body = (await res.text()).slice(0, 300);
			return json({
				success: false,
				baseUrl,
				status: res.status,
				latencyMs,
				error:
					res.status === 401
						? 'Cron-vakta avviste kallet — CRON_SECRET stemmer ikke med det appen forventer.'
						: body || `Fikk ${res.status} fra registeret.`
			});
		}

		const jobs = await res.json();
		return json({
			success: true,
			baseUrl,
			status: res.status,
			latencyMs,
			jobCount: Array.isArray(jobs) ? jobs.length : null
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({
			success: false,
			baseUrl,
			latencyMs: Date.now() - started,
			error:
				err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
					? `Ingen svar innen 10 s fra ${baseUrl} — appen svarer ikke på loopback-adressen.`
					: `Nådde ikke ${baseUrl}: ${message}`
		});
	}
};
