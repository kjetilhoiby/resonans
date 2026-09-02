import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import {
	endSickPeriod,
	getSickState,
	saveSickPeriod,
	todayOsloKey
} from '$lib/server/health/sick-log';

/**
 * Tilstand-flaggene fra `ReadinessStrip` på treningsprogram-siden.
 *
 * **`sickUntil` går gjennom `sick-log`, ikke inn i dette eventet.** Sykdom er en
 * periode siden september 2026, og en `sickUntil` skrevet her ville vært en andre
 * sannhet: readiness ville sett den, men streaks, effort-budsjettet og
 * helsechatten ikke — nettopp den splitten som gjorde det gamle flagget
 * ubrukelig. Endepunktet beholdes fordi bryteren på programsida er en reell
 * inngang; den skriver bare til den samme stien som Helse-flaten nå.
 *
 * `crunchUntil` er fortsatt et nå-flagg her. Ingen konsument spør hvilke DAGER
 * som var travle, så en periodemodell for crunch ville vært kode uten en leser.
 */

async function getOrCreateTilstandSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'tilstand_flag'))
	});
	if (existing) return existing;
	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'tilstand_flag',
			type: 'manual_log',
			subtype: 'tilstand_flag',
			name: 'Tilstand-flagg',
			isActive: true
		})
		.returning();
	return created;
}

function parseUntil(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	return undefined;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));
	const sickUntil = parseUntil(body?.sickUntil);
	const crunchUntil = parseUntil(body?.crunchUntil);
	const note = typeof body?.note === 'string' ? body.note.trim() || null : null;

	if (sickUntil === undefined && crunchUntil === undefined) {
		return json({ error: 'Må sende sickUntil eller crunchUntil' }, { status: 400 });
	}

	if (sickUntil !== undefined) {
		const current = await getSickState(userId);
		if (sickUntil === null) {
			// Klarert: avslutt en pågående periode framfor å skrive et av-flagg.
			// Sluttdatoen er `endSickPeriod`s beslutning (gårsdagen), ikke vår.
			if (current.period) {
				const ended = await endSickPeriod(userId, current.period.id);
				if (!ended.ok) return json({ error: ended.error }, { status: 400 });
			}
		} else if (current.period) {
			// Flytt sluttdatoen på den pågående perioden. En ny rad her ville gitt
			// to overlappende perioder for det samme sykdomsforløpet.
			const moved = await saveSickPeriod(userId, {
				id: current.period.id,
				startDate: current.period.startDate,
				endDate: sickUntil,
				note: note ?? current.period.note
			});
			if (!moved.ok) return json({ error: moved.error }, { status: 400 });
		} else {
			const created = await saveSickPeriod(userId, {
				startDate: todayOsloKey(),
				endDate: sickUntil,
				note
			});
			if (!created.ok) return json({ error: created.error }, { status: 400 });
		}
	}

	if (crunchUntil !== undefined) {
		const sensor = await getOrCreateTilstandSensor(userId);
		const payload: Record<string, unknown> = { crunchUntil };
		if (note) payload.note = note;
		await SensorEventService.write({
			userId,
			sensorId: sensor.id,
			eventType: 'measurement',
			dataType: 'tilstand_flag',
			timestamp: new Date(),
			data: payload,
			source: 'tilstand_flag_ui'
		});
	}

	const sick = await getSickState(userId);
	return json({ ok: true, sickUntil: sick.until, sickFrom: sick.from, crunchUntil });
};
