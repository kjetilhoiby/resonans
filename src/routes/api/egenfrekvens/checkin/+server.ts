import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	EgenfrekvensCheckinError,
	getEgenfrekvensCheckinStatus,
	submitEgenfrekvensCheckin,
	submitEgenfrekvensQuick,
	toIsoDay,
	type EgenfrekvensSlot
} from '$lib/server/egenfrekvens-checkin';
import { isPeriodSlotId } from '$lib/domains/egenfrekvens/period-slots';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const dayParam = url.searchParams.get('day');
	const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : toIsoDay();
	const status = await getEgenfrekvensCheckinStatus(locals.userId, day);
	return json(status);
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
	const eventId = url.searchParams.get('id');
	if (!eventId) return json({ error: 'Mangler id' }, { status: 400 });

	const deleted = await db
		.delete(sensorEvents)
		.where(and(
			eq(sensorEvents.id, eventId),
			eq(sensorEvents.userId, locals.userId),
			eq(sensorEvents.dataType, 'egenfrekvens_checkin')
		))
		.returning({ id: sensorEvents.id });

	if (deleted.length === 0) return json({ error: 'Ikke funnet' }, { status: 404 });
	return json({ ok: true });
};

function parseSlot(value: unknown): EgenfrekvensSlot | null {
	if (value === 'morning' || value === 'evening' || isPeriodSlotId(value)) return value;
	return null;
}

// '' / null = bruker fjerner aktiv flagg, gyldig dato = ny verdi, undefined = uendret
function parseTilstandUntil(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	return undefined;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const day =
			typeof body?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : toIsoDay();

		const sickUntil = parseTilstandUntil(body?.sickUntil);
		const crunchUntil = parseTilstandUntil(body?.crunchUntil);

		// Kjapp-variant: kun level + slot, ingen dimensjoner
		const hasDimensions = body?.actions !== undefined || body?.feelings !== undefined || body?.thoughts !== undefined;
		if (body?.level !== undefined && !hasDimensions) {
			const level = Number(body.level);
			const slot = parseSlot(body.slot);
			if (!slot) {
				return json({ error: 'Ugyldig slot.' }, { status: 400 });
			}
			const note = typeof body.note === 'string' ? body.note : null;
			const status = await submitEgenfrekvensQuick({
				userId: locals.userId,
				level,
				slot,
				note,
				day,
				sickUntil,
				crunchUntil
			});
			return json(status);
		}

		// Dypdykk-variant (3 dimensjoner + level)
		const level = Number(body?.level);
		const thoughts = Number(body?.thoughts);
		const feelings = Number(body?.feelings);
		const actions = Number(body?.actions);
		const note = typeof body?.note === 'string' ? body.note : null;
		const reflection = typeof body?.reflection === 'string' ? body.reflection : null;
		const reasons = body?.reasons && typeof body.reasons === 'object' ? body.reasons : null;
		const reflectionThread = Array.isArray(body?.reflectionThread) ? body.reflectionThread : null;
		const slot = parseSlot(body?.slot);

		const status = await submitEgenfrekvensCheckin({
			userId: locals.userId,
			level,
			thoughts,
			feelings,
			actions,
			slot,
			note,
			reflection,
			reflectionThread,
			reasons,
			day,
			sickUntil,
			crunchUntil
		});

		return json(status);
	} catch (error) {
		if (error instanceof EgenfrekvensCheckinError) {
			return json({ error: error.message }, { status: 400 });
		}
		console.error('Failed to submit egenfrekvens check-in:', error);
		return json({ error: 'Kunne ikke lagre egenfrekvens-sjekkin.' }, { status: 500 });
	}
};
