/**
 * Gjør et feilsvar fra våre egne API-ruter om til én lesbar setning.
 *
 * Kroppen kan ha tre former:
 *  - `{ error: '…' }` — våre egne håndterte feil (`json({ error }, { status })`)
 *  - `{ message: '…', errorId: '…' }` — uventede feil via `handleError`
 *  - HTML — SvelteKits feilside, når noe feiler før ruten svarer
 *
 * Uten dette endte feilteksten i UI-et opp som en hel HTML-side, og
 * kallstedene valgte derfor å kaste den helt (`catch {}`). Det var grunnen til
 * at «Kunne ikke laste dashboarddata.» var alt vi visste da mor-dashboardet
 * feilet i prod.
 */
export function extractApiErrorMessage(status: number, bodyText: string): string {
	const fallback = `HTTP ${status}`;
	const body = bodyText?.trim();
	if (!body) return fallback;

	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const message =
			typeof parsed.error === 'string'
				? parsed.error
				: typeof parsed.message === 'string'
					? parsed.message
					: null;
		if (message) {
			const id = typeof parsed.errorId === 'string' ? ` (${parsed.errorId})` : '';
			return `${fallback}: ${message}${id}`;
		}
	} catch {
		// Ikke JSON — sannsynligvis SvelteKits HTML-feilside.
	}

	// HTML: <title> er den mest informative biten, ellers gir vi opp og lar
	// statuskoden stå alene framfor å vise markup til brukeren.
	const title = /<title>([^<]+)<\/title>/i.exec(body)?.[1]?.trim();
	if (title) return `${fallback}: ${title}`;
	if (/^\s*</.test(body)) return fallback;

	return `${fallback}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`;
}
