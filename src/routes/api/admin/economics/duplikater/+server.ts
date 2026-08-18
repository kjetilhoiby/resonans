import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { diagnoseDuplicates, MAX_LIMIT } from '$lib/server/economics/duplicate-diagnosis';
import type { RequestHandler } from './$types';

/**
 * GET /api/admin/economics/duplikater
 *
 * Duplikater vi ikke fanger, og hvorfor. **Ren lesing — ingen rader røres.**
 *
 * Fram til 18. august 2026 måtte dette tallet hentes med en POST mot skriveendepunktet
 * (`deaktiver-reservasjoner?dryRun=true`), i nettleseren, med JSON kopiert ut for hver hypotese.
 * En diagnose skal kunne kjøres hundre ganger uten at noen tenker på om den skriver, og
 * tersklene skal kunne varieres **uten en deploy**.
 *
 * Parametere:
 * - `days` (90) — vindu bakover.
 * - `maxDeltaDays` (3) — hvor mange dager to versjoner kan ligge fra hverandre.
 * - `tolerancePct` (3) — beløpsavvik i prosent som fortsatt regnes som samme kjøp.
 * - `requireDescriptionMatch` (`true`) — sett `false` for å MÅLE hvor mye beskrivelseskravet
 *   utelater. Det gir falske positive med vilje: to ekte Kiwi-kjøp på nesten samme beløp dukker
 *   opp. Poenget er å vite om kravet er en riktig grense eller en blindsone.
 * - `limit` (100, tak 500) — `truncated` sier om lista er kappet.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

const DEFAULT_DAYS = 90;
const MAX_DAYS = 730;

/** Leser et valgfritt tall og avviser søppel framfor å falle tilbake på standarden. */
function numberParam(
	url: URL,
	name: string,
	bounds: { min: number; max: number }
): number | undefined {
	const raw = url.searchParams.get(name);
	if (raw === null || raw === '') return undefined;
	const value = Number(raw);
	// **En stille default på en ugyldig verdi er verre enn et avslag.** Svaret ville sett riktig
	// ut mens parameteren man trodde man varierte ikke hadde noen virkning — og da måler man det
	// samme to ganger og tror det er et funn.
	if (!Number.isFinite(value) || value < bounds.min || value > bounds.max) {
		error(400, `${name} må være mellom ${bounds.min} og ${bounds.max}.`);
	}
	return value;
}

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const days = numberParam(url, 'days', { min: 1, max: MAX_DAYS }) ?? DEFAULT_DAYS;

	const requireDescriptionParam = url.searchParams.get('requireDescriptionMatch');
	if (
		requireDescriptionParam !== null &&
		requireDescriptionParam !== 'true' &&
		requireDescriptionParam !== 'false'
	) {
		error(400, 'requireDescriptionMatch må være «true» eller «false».');
	}

	const result = await diagnoseDuplicates(locals.userId, {
		days: Math.floor(days),
		maxDeltaDays: numberParam(url, 'maxDeltaDays', { min: 0, max: 30 }),
		amountTolerancePct: numberParam(url, 'tolerancePct', { min: 0, max: 25 }),
		requireDescriptionMatch: requireDescriptionParam !== 'false',
		limit: numberParam(url, 'limit', { min: 1, max: MAX_LIMIT })
	});

	return json(result);
};
