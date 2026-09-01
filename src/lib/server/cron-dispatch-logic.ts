import type { CronJob } from '$lib/server/cron-jobs';

/**
 * Ren logikk for cron-dispatcheren — skilt fra `cron-dispatcher.ts`, som
 * holder tilstand (lederlås, in-flight) og snakker med DB og nettverk.
 */

/**
 * Basen dispatcheren self-fetcher mot.
 *
 * Default er loopback, ikke `ORIGIN`: et kall gjennom den offentlige adressen
 * ville gått ut gjennom Traefik og inn igjen, og hairpin-ruting inne i et
 * docker-nettverk er nettopp den typen ting som virker helt til den ikke gjør
 * det. `127.0.0.1`, aldri `localhost` — samme lærdom som healthchecken:
 * localhost kan resolve til `::1` mens adapter-node lytter på `0.0.0.0`.
 */
export function resolveDispatchBaseUrl(env: {
	CRON_DISPATCH_BASE_URL?: string;
	PORT?: string;
}): string {
	const configured = env.CRON_DISPATCH_BASE_URL?.trim();
	if (configured) return configured.replace(/\/+$/, '');
	return `http://127.0.0.1:${env.PORT?.trim() || '3000'}`;
}

/** Samme default som GitHub Actions-workflowen: 30 s når jobben ikke sier noe annet. */
export function dispatchTimeoutMs(job: Pick<CronJob, 'maxDurationSeconds'>): number {
	return (job.maxDurationSeconds ?? 30) * 1000;
}

/**
 * Skal kravet slippes så slotet kan prøves på nytt?
 *
 * Bare når forespørselen aldri nådde serveren (ECONNREFUSED, DNS, reset før
 * svar). En timeout (`TimeoutError`/`AbortError` fra `AbortSignal.timeout`)
 * betyr at forespørselen BLE sendt — endepunktet kjører videre på serveren
 * etter at fetch ga opp, og et sluppet krav ville dispatchet jobben én gang
 * til oppå seg selv.
 */
export function shouldReleaseClaimOnDispatchError(err: unknown): boolean {
	if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
		return false;
	}
	return true;
}
