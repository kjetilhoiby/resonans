/**
 * Kjør en async-oppgave i bakgrunnen som overlever responsen.
 *
 * Under adapter-node lever Node-prosessen videre etter at responsen er sendt,
 * så en promise som ikke ventes på tikker ferdig av seg selv på event-loopen.
 * Det var ikke tilfellet på serverless, der funksjonen ble frosset i det
 * responsen gikk ut — derfor lå det tidligere en `waitUntil` fra
 * `@vercel/functions` her. Den er borte sammen med resten av Vercel-oppsettet.
 *
 * Prisen ved en container er en annen: en redeploy sender SIGTERM, og arbeid
 * som ikke er ferdig da, blir ikke ferdig. Bruk derfor jobbkøen
 * (`background_jobs`) for noe som MÅ fullføres — denne er for etterarbeid der
 * et tapt forsøk er greit.
 */

export function runInBackground(promise: Promise<unknown>): void {
	void promise.catch((err) => {
		console.error('[runInBackground] uncaught error:', err);
	});
}
