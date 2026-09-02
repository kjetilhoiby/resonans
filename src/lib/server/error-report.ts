/**
 * Feilrapportering for uventede serverfeil.
 *
 * Bakgrunn: repoet hadde ingen `handleError`-hook, så en kastet feil i en
 * `+server.ts` eller en `load` ble til `{"message":"Internal Error"}` uten
 * rute, uten stack og uten noe å søke etter i serverloggen. Da mor-dashboardet
 * feilet i prod (se `docs/changelog/2026-08-02-helse-mortema.md`) var eneste
 * spor teksten «Kunne ikke laste dashboarddata.» i UI-et.
 *
 * Rene funksjoner her, hooken i `hooks.server.ts` — slik at formatet er testet.
 */

/** Kortform av en ukjent kastet verdi. Alt kan kastes i JS, ikke bare Error. */
export function describeError(error: unknown): { name: string; message: string; stack: string | null } {
	if (error instanceof Error) {
		return {
			name: error.name || 'Error',
			message: error.message || String(error),
			stack: error.stack ?? null
		};
	}
	if (typeof error === 'string') return { name: 'Error', message: error, stack: null };
	if (error && typeof error === 'object') {
		const message = 'message' in error ? String((error as { message: unknown }).message) : JSON.stringify(error);
		return { name: error.constructor?.name ?? 'Object', message, stack: null };
	}
	return { name: 'Error', message: String(error), stack: null };
}

/**
 * Én linje som er lett å kjenne igjen i loggen, pluss stacken under.
 *
 * Prefikset `[500]` er bevisst: det er det man søker etter i loggen — i
 * containerloggen, eller over `GET /api/admin/logs?grep=[500]`.
 * `errorId` gjentas i svaret til klienten, så en skjermdump kan kobles til
 * loggraden.
 */
export function formatErrorLog(input: {
	errorId: string;
	routeId: string | null;
	method: string;
	path: string;
	status: number;
	error: unknown;
}): string {
	const { name, message, stack } = describeError(input.error);
	const head = `[500] id=${input.errorId} status=${input.status} ${input.method} ${input.path} route=${input.routeId ?? '?'} ${name}: ${message}`;
	return stack ? `${head}\n${stack}` : head;
}

/**
 * Meldingen klienten får. Vi sender den ekte feilteksten videre, ikke bare
 * «Internal Error»: Resonans er en énbruker-app, og monitoreringen bygger
 * allerede på at brukeren kan kopiere en feilbeskrivelse rett inn til en agent.
 * Stacken holdes på serveren.
 */
export function clientErrorMessage(error: unknown, maxLength = 300): string {
	const { message } = describeError(error);
	const clean = message.replace(/\s+/g, ' ').trim();
	if (!clean) return 'Uventet feil på serveren.';
	return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}
