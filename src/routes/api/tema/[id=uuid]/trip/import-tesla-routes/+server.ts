import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, sensorEvents } from '$lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { getTeslaSensor } from '$lib/server/integrations/tesla-sync';
import { buildDriveRoutes, type DriveRoutes } from '$lib/server/tesla-routes';

// Importerer kjørespor fra Teslas drive_state-breadcrumbs inn i
// tripProfile.driveRoutes, så kartfortellingen kan tegne linja langs faktisk
// kjørte veier i stedet for luftlinje mellom dagpunktene. Vinduet hentes fra
// tripProfile (reise-tema) eller ferieProfile (ferie-tema). Frosset i profilen
// slik at kartet overlever at sensor_events tynnes ut.

export const POST: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true, tripProfile: true, ferieProfile: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const trip = (theme.tripProfile ?? {}) as { startDate?: string; endDate?: string; driveRoutes?: DriveRoutes };
	const ferie = (theme.ferieProfile ?? {}) as { startDate?: string; endDate?: string };
	const startDate = trip.startDate ?? ferie.startDate;
	const endDate = trip.endDate ?? ferie.endDate;
	if (!startDate || !endDate) {
		return json({ error: 'Temaet mangler start- og sluttdato' }, { status: 400 });
	}

	const sensor = await getTeslaSensor(locals.userId);
	if (!sensor) {
		return json({ error: 'Ingen aktiv Tesla-tilkobling' }, { status: 400 });
	}

	// Rause UTC-grenser (±1 døgn); osloDayKey-grupperingen i buildDriveRoutes
	// plasserer punktene på riktig lokal dag, og vindus-filteret under kutter eksakt.
	const from = new Date(Date.parse(`${startDate}T00:00:00Z`) - 86_400_000);
	const to = new Date(Date.parse(`${endDate}T23:59:59Z`) + 86_400_000);

	const rows = await db.query.sensorEvents.findMany({
		where: and(
			eq(sensorEvents.sensorId, sensor.id),
			eq(sensorEvents.dataType, 'drive_state'),
			gte(sensorEvents.timestamp, from),
			lte(sensorEvents.timestamp, to)
		),
		columns: { timestamp: true, data: true }
	});

	const points = rows.flatMap((r) => {
		const d = (r.data ?? {}) as { lat?: number; lon?: number };
		if (typeof d.lat !== 'number' || typeof d.lon !== 'number') return [];
		return [{ lat: d.lat, lon: d.lon, timestamp: r.timestamp }];
	});

	const built = buildDriveRoutes(points);
	const inWindow: DriveRoutes = {};
	for (const [day, coords] of Object.entries(built)) {
		if (day >= startDate && day <= endDate) inWindow[day] = coords;
	}

	// RMW-merge: nye dager overskriver samme dag, andre felter/dager beholdes.
	const fresh = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { tripProfile: true }
	});
	const profile = { ...((fresh?.tripProfile ?? {}) as Record<string, unknown>) };
	profile.driveRoutes = { ...((profile.driveRoutes ?? {}) as DriveRoutes), ...inWindow };

	await db
		.update(themes)
		.set({ tripProfile: profile, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({
		days: Object.keys(inWindow).length,
		points: Object.values(inWindow).reduce((sum, c) => sum + c.length, 0)
	});
};
