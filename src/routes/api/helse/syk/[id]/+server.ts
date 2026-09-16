import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	confirmSickPeriod,
	deleteSickPeriod,
	endSickPeriod,
	listSickPeriods,
	saveSickPeriod
} from '$lib/server/health/sick-log';
import { buildSickPayload } from '$lib/server/health/sick-payload';

/**
 * Rett en periode, friskmeld, eller bekreft at den fortsatt gjelder.
 *
 * `{ action: 'end' }` er friskmeldingen: den setter sluttdato uten at flaten må
 * regne ut hvilken dag det blir. Regelen (gårsdagen, ikke i dag) bor i
 * `endSickPeriod` — den er en beslutning, ikke en formattering.
 *
 * `{ action: 'confirm' }` er det motsatte svaret på det samme spørsmålet, og
 * derfor på samme endepunkt: «fortsatt syk» flytter livstegnet til i dag, så
 * taket på åpne perioder ikke ryker på noe annet enn glemsel.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));

	if (body?.action === 'confirm') {
		const result = await confirmSickPeriod(userId, params.id);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json(await buildSickPayload(userId));
	}

	if (body?.action === 'end') {
		const result = await endSickPeriod(
			userId,
			params.id,
			typeof body?.endDate === 'string' ? body.endDate : undefined
		);
		if (!result.ok) return json({ error: result.error }, { status: 400 });
		return json(await buildSickPayload(userId));
	}

	const existing = (await listSickPeriods(userId)).find((p) => p.id === params.id);
	if (!existing) return json({ error: 'Fant ikke sykeperioden.' }, { status: 404 });

	// Utelatte felter beholdes. Et felt sendt som null er en SLETTING av verdien
	// («ingen sluttdato» = syk inntil videre) — samme skille som i ernæringsmålene.
	const result = await saveSickPeriod(userId, {
		id: params.id,
		startDate: typeof body?.startDate === 'string' ? body.startDate : existing.startDate,
		endDate: body?.endDate === undefined ? existing.endDate : body.endDate,
		note: body?.note === undefined ? existing.note : body.note,
		// Bæres med fra den lagrede raden, aldri fra kroppen: `data` skrives i sin
		// helhet, så et felt kalleren ikke kjenner til må løftes tilbake — samme
		// regel som `USER_OWNED_METADATA_KEYS` på øktene.
		confirmedOn: existing.confirmedOn
	});
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	return json(await buildSickPayload(userId));
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const removed = await deleteSickPeriod(userId, params.id);
	if (!removed) return json({ error: 'Fant ikke sykeperioden.' }, { status: 404 });
	return json(await buildSickPayload(userId));
};
