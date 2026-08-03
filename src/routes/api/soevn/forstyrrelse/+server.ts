import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteDisturbance,
	listDisturbances,
	logDisturbance
} from '$lib/server/sleep/disturbance-log';
import { isSleepDisturbanceKind, MAX_AWAKE_MINUTES } from '$lib/domain/sleep/disturbance';
import { todayAtLocalTime } from '$lib/domain/sleep-goals';
import { invalidateSleepAggregates } from '$lib/server/sleep/aggregate-refresh';

/**
 * Selvrapporterte søvnforstyrrelser.
 *
 * Ligger under /api/soevn/ ved siden av nap-endepunktet framfor under
 * /api/helse/, fordi de to hører sammen: begge er manuell søvnregistrering, og
 * å splitte dem over to prefikser ville bare gjort dem vanskeligere å finne.
 *
 * POST { kind: 'innsovning' | 'oppvaakning', at?: 'HH:MM' | ISO, awakeMinutes?, note? }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) return json({ error: 'Ugyldig forespørsel.' }, { status: 400 });

	if (!isSleepDisturbanceKind(body.kind)) {
		return json({ error: 'kind må være «innsovning» eller «oppvaakning».' }, { status: 400 });
	}

	// Samme tidsparsing som nap-endepunktet: «HH:MM» tolkes som i dag, Oslo-tid.
	let at: Date | undefined;
	if (typeof body.at === 'string' && body.at.trim()) {
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
		if (at > new Date()) {
			return json({ error: 'Tidspunktet kan ikke være i framtiden.' }, { status: 400 });
		}
	}

	// Minutter er valgfritt: «vet ikke» er et gyldig svar kl. 03 om natta, og å
	// kreve et tall der ville gjort registreringen til en oppgave.
	let awakeMinutes: number | null = null;
	if (body.awakeMinutes !== undefined && body.awakeMinutes !== null && body.awakeMinutes !== '') {
		const parsed = Number(body.awakeMinutes);
		if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AWAKE_MINUTES) {
			return json({ error: `awakeMinutes må være 0–${MAX_AWAKE_MINUTES}.` }, { status: 400 });
		}
		awakeMinutes = parsed;
	}

	const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

	const created = await logDisturbance({
		userId: locals.userId,
		kind: body.kind,
		timestamp: at,
		awakeMinutes,
		note
	});

	await invalidateSleepAggregates(locals.userId, at).catch((err) =>
		console.error('[søvn] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true, entry: created }, { status: 201 });
};

/** Forstyrrelsene i et vindu bakover. `days` er 1–90, standard 30. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const daysParam = Number(url.searchParams.get('days'));
	const sinceDays = Number.isFinite(daysParam) && daysParam >= 1 && daysParam <= 90 ? daysParam : 30;
	const entries = await listDisturbances(locals.userId, { sinceDays });
	return json({ days: sinceDays, entries });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Mangler id.' }, { status: 400 });

	const deleted = await deleteDisturbance(locals.userId, id);
	if (!deleted) return json({ error: 'Fant ingen forstyrrelse med denne id-en.' }, { status: 404 });

	await invalidateSleepAggregates(locals.userId).catch((err) =>
		console.error('[søvn] aggregat-oppdatering feilet', err)
	);

	return json({ ok: true });
};
