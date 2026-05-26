/**
 * Kjør en async-oppgave i bakgrunnen som overlever responsen.
 *
 * På Vercel serverless dør funksjonen så fort responsen er sendt, så
 * `void promise` blir kuttet. `waitUntil` fra @vercel/functions ber
 * runtimet holde funksjonen i live til promisen settler.
 *
 * Lokalt (dev) er waitUntil en no-op, men der lever Node-prosessen
 * uansett til promisen er ferdig — så det funker også.
 */

import { waitUntil } from '@vercel/functions';

export function runInBackground(promise: Promise<unknown>): void {
	const guarded = promise.catch((err) => {
		console.error('[runInBackground] uncaught error:', err);
	});
	try {
		waitUntil(guarded);
	} catch {
		// waitUntil throws if not in a request context (e.g. during build).
		// The promise itself is still ticking via the event loop.
	}
}
