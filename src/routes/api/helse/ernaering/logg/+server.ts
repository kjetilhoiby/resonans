import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listIntake, logIntake } from '$lib/server/nutrition/intake-log';
import { parseEstimateResponse } from '$lib/domain/nutrition/estimate';
import { invalidateNutritionAggregates } from '$lib/server/nutrition/aggregate-refresh';

/** Loggen for et vindu bakover. `days` er 1–90, standard 7. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const daysParam = Number(url.searchParams.get('days'));
	const days = Number.isFinite(daysParam) && daysParam >= 1 && daysParam <= 90 ? daysParam : 7;
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const entries = await listIntake(locals.userId, { since });
	return json({ days, entries });
};

/**
 * Lagrer et estimat i loggen.
 *
 * Estimatet kommer fra klienten og går gjennom `parseEstimateResponse` før det
 * lagres — brukeren kan ha rettet tallene, men formen skal fortsatt være vår.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as
		| { estimate?: unknown; imageUrl?: string; descriptions?: string[]; timestamp?: string }
		| null;

	if (!body?.estimate) {
		return json({ error: 'Mangler estimat.' }, { status: 400 });
	}

	const estimate = parseEstimateResponse(body.estimate, 'manual');
	if (estimate.items.length === 0) {
		return json({ error: 'Estimatet har ingen varer å lagre.' }, { status: 400 });
	}

	// Klienten kan sende et tidspunkt for et måltid man logger i etterkant, men
	// bare bakover: en logg fra framtiden ville ødelagt dagssummene.
	const parsedTimestamp = body.timestamp ? new Date(body.timestamp) : null;
	const timestamp =
		parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime()) && parsedTimestamp <= new Date()
			? parsedTimestamp
			: new Date();

	const created = await logIntake({
		userId: locals.userId,
		estimate,
		timestamp,
		imageUrl: body.imageUrl ?? null,
		descriptions: Array.isArray(body.descriptions)
			? body.descriptions.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
			: []
	});

	// Dagens og ukas aggregater er nå utdaterte. Uten dette viser
	// undertema-flisen gårsdagens tall til neste cron-kjøring.
	await invalidateNutritionAggregates(locals.userId, timestamp).catch((err) =>
		console.error('[ernæring] aggregat-oppdatering feilet', err)
	);

	return json({ entry: { id: created.id, timestamp: created.timestamp } }, { status: 201 });
};
