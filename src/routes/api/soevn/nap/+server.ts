import { json } from '@sveltejs/kit';
import {
	deleteNap,
	listRecentNaps,
	logNap,
	reclassifyNap,
	updateNap
} from '$lib/server/integrations/sleep-goals';
import {
	normalizeNapNote,
	validateNapDuration,
	validateNapStart
} from '$lib/domain/sleep/nap-fields';
import { todayAtLocalTime } from '$lib/domain/sleep-goals';
import { invalidateSleepAggregates } from '$lib/server/sleep/aggregate-refresh';
import type { RequestHandler } from './$types';

/**
 * Manuell powernap-registrering.
 * POST { durationMinutes: 5–180, at?: 'HH:MM' (i dag, Oslo-tid) | ISO-timestamp, note? }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json();

	// Samme validator som PATCH og flaten, så grensene bor på ett sted.
	const durationMinutes = Number(body?.durationMinutes);
	const durationError = validateNapDuration(durationMinutes);
	if (durationError) return json({ error: durationError }, { status: 400 });

	let at: Date | undefined;
	if (typeof body?.at === 'string' && body.at.trim()) {
		const raw = body.at.trim();
		const asToday = todayAtLocalTime(raw);
		if (asToday) {
			at = asToday;
		} else {
			const asIso = new Date(raw);
			if (!Number.isFinite(asIso.getTime())) {
				return json({ error: `Ugyldig tidspunkt: ${raw}` }, { status: 400 });
			}
			at = asIso;
		}
		/**
		 * Samme framtidssjekk som PATCH.
		 *
		 * Den er reelt nødvendig, ikke defensiv: `todayAtLocalTime('13:30')` peker på
		 * **dagens dato i Oslo**, og etter midnatt Oslo (altså sent på kvelden i UTC) er
		 * det en dato som ennå ikke har hatt sin kl. 13:30. Uten sjekken kunne man
		 * registrere en dupp tretten timer fram i tid, som ville telt i aggregatet for en
		 * dag som ikke har skjedd.
		 */
		const startError = validateNapStart(at);
		if (startError) return json({ error: startError }, { status: 400 });
	}

	const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
	const nap = await logNap(locals.userId, { durationMinutes, at, note });

	// Powernaps holdes ute av nattsnittet, men de teller i powernap-signalet og
	// i ukesmetrikken. Uten dette ser flaten uendret ut til neste cron-kjøring.
	await invalidateSleepAggregates(locals.userId, at).catch((err) =>
		console.error('[søvn] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true, nap });
};

export const GET: RequestHandler = async ({ locals }) => {
	const naps = await listRecentNaps(locals.userId);
	return json({ naps });
};

/**
 * Retting av en dupp.
 *
 * To ulike operasjoner bak samme verb, fordi de svarer på samme brukerhandling («dette
 * stemmer ikke»):
 *
 * - `{ durationMinutes?, at?, note? }` retter en **manuell** dupp.
 * - `{ isNap: false }` sier at en **oppdaget** dupp ikke var en dupp. Withings-raden
 *   består — den er en ekte måling — men klassifiseringen er vår og kan rettes.
 *
 * Serveren avgjør hvilken som er lovlig ut fra raden, ikke klienten: `updateNap` nekter
 * på oppdagede rader og `reclassifyNap` nekter på manuelle.
 */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const id = typeof (body as { id?: unknown } | null)?.id === 'string' ? (body as { id: string }).id : null;
	if (!id) return json({ error: 'Mangler id' }, { status: 400 });

	// Omklassifisering først: den er sin egen operasjon, ikke et felt blant andre.
	if (typeof (body as { isNap?: unknown }).isNap === 'boolean') {
		const ok = await reclassifyNap(locals.userId, id, (body as { isNap: boolean }).isNap);
		if (!ok) {
			return json(
				{ error: 'Fant ingen oppdaget dupp med denne id-en. Manuelle dupper slettes i stedet.' },
				{ status: 404 }
			);
		}
		await invalidateSleepAggregates(locals.userId).catch((err) =>
			console.error('[søvn] aggregat-oppdatering feilet', err)
		);
		return json({ ok: true, reclassified: true });
	}

	const patch: { durationMinutes?: number; at?: Date; note?: string | null } = {};

	if ('durationMinutes' in (body as object)) {
		const value = Number((body as { durationMinutes: unknown }).durationMinutes);
		const error = validateNapDuration(value);
		if (error) return json({ error }, { status: 400 });
		patch.durationMinutes = Math.round(value);
	}

	if (typeof (body as { at?: unknown }).at === 'string' && (body as { at: string }).at.trim()) {
		const raw = (body as { at: string }).at.trim();
		const at = todayAtLocalTime(raw) ?? new Date(raw);
		const error = validateNapStart(at);
		if (error) return json({ error }, { status: 400 });
		patch.at = at;
	}

	const note = normalizeNapNote((body as { note?: unknown }).note);
	if (note !== undefined) patch.note = note;

	if (Object.keys(patch).length === 0) {
		return json({ error: 'Ingenting å endre.' }, { status: 400 });
	}

	const nap = await updateNap(locals.userId, id, patch);
	if (!nap) {
		return json(
			{ error: 'Fant ingen manuell dupp med denne id-en. Oppdagede dupper kan bare omklassifiseres.' },
			{ status: 404 }
		);
	}

	// Varighet og tidspunkt påvirker powernap-signalet og ukesmetrikken.
	await invalidateSleepAggregates(locals.userId, nap.start).catch((err) =>
		console.error('[søvn] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true, nap });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Mangler id' }, { status: 400 });
	const deleted = await deleteNap(locals.userId, id);
	if (!deleted) return json({ error: 'Fant ingen manuell nap med denne id-en' }, { status: 404 });

	await invalidateSleepAggregates(locals.userId).catch((err) =>
		console.error('[søvn] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true });
};
