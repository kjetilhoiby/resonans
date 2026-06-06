/**
 * POST /api/tema/[id]/import-stays
 *
 * Utleder opphold fra dagsplanene («Sted: X» sammenhengende dager) innenfor
 * reisetemaets datovindu, og fletter dem additivt inn i tripProfile.overnightStays.
 * Idempotent: opphold som allerede finnes (samme navn + datoer) hoppes over,
 * og manuelt opprettede opphold beholdes. Fase C.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { computeStaysFromDayPlans } from '$lib/server/stays';

interface OvernightStay {
	id: string;
	name: string;
	checkIn: string;
	checkOut: string;
	refNumber?: string;
	lockCode?: string;
	address?: string;
	notes?: string;
}

export const POST: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId)),
		columns: { tripProfile: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const profile = (theme.tripProfile ?? {}) as Record<string, unknown> & {
		startDate?: string;
		endDate?: string;
		overnightStays?: OvernightStay[];
	};

	if (!profile.startDate || !profile.endDate) {
		return json({ error: 'Reisen mangler start-/sluttdato' }, { status: 400 });
	}

	const stays = await computeStaysFromDayPlans(userId, profile.startDate, profile.endDate);

	const existing = profile.overnightStays ?? [];
	const seen = new Set(
		existing.map((s) => `${s.name.toLowerCase()}|${s.checkIn}|${s.checkOut}`)
	);

	const added: OvernightStay[] = [];
	for (const stay of stays) {
		const key = `${stay.place.toLowerCase()}|${stay.startDate}|${stay.endDate}`;
		if (seen.has(key)) continue;
		seen.add(key);
		added.push({
			id: crypto.randomUUID(),
			name: stay.place,
			checkIn: stay.startDate,
			checkOut: stay.endDate,
			notes: 'Importert fra dagsplan'
		});
	}

	if (added.length === 0) {
		return json({ success: true, added: 0, stays: existing });
	}

	const mergedProfile = { ...profile, overnightStays: [...existing, ...added] };
	await db
		.update(themes)
		.set({ tripProfile: mergedProfile, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, userId)));

	return json({ success: true, added: added.length, stays: mergedProfile.overnightStays });
};
