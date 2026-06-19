import { z } from 'zod';
import { db } from '$lib/db';
import { sensors, sensorEvents } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { getTeslaSensor, syncTeslaForUser } from '$lib/server/integrations/tesla-sync';

/**
 * AI-verktøy: gjeldende tilstand for brukerens Tesla (batteri, lading, posisjon,
 * km-stand, klima). Leser ferskeste lagrede sensor-events; `forceLive=true`
 * henter et nytt øyeblikksbilde direkte fra Tesla (kan vekke bilen — bruk sparsomt).
 */
export const queryTeslaVehicleTool = {
	name: 'query_tesla_vehicle',
	description: `Hent gjeldende tilstand for brukerens Tesla: batteriprosent, rekkevidde, ladestatus, posisjon, kilometerstand, lås og innetemperatur.

Bruk dette når brukeren spør om:
- Lading/batteri: "Hvor mye strøm har bilen?", "Er Teslaen ladet?", "Hvor langt rekker jeg?"
- Posisjon: "Hvor står bilen?", "Er bilen hjemme?"
- Kjøretøy: "Er bilen låst?", "Hvor mange km har bilen gått?"
- Før en kjøretur: sjekk rekkevidde mot reisemål.

Returnerer enten ferskeste lagrede data, eller (med forceLive) et nytt øyeblikksbilde. Hvis bilen sover, kan posisjon/fart mangle.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		forceLive: z
			.boolean()
			.optional()
			.describe('Hent ferskt øyeblikksbilde direkte fra Tesla (kan vekke bilen). Default: les lagrede data.')
	}),

	execute: async (args: { userId: string; forceLive?: boolean }) => {
		const { userId, forceLive } = args;

		const sensor = await getTeslaSensor(userId);
		if (!sensor) {
			return {
				success: false,
				message: 'Ingen aktiv Tesla-tilkobling. Bruker må koble til Tesla under Kilder.'
			};
		}

		if (forceLive) {
			try {
				const r = await syncTeslaForUser(userId);
				return {
					success: true,
					data: { source: 'live', asleep: r.asleep, snapshot: r.snapshot }
				};
			} catch (err) {
				return {
					success: false,
					message: `Kunne ikke hente live-data fra Tesla: ${err instanceof Error ? err.message : String(err)}`
				};
			}
		}

		// Les ferskeste lagrede event per dataType.
		const latestByType: Record<string, { timestamp: Date; data: Record<string, unknown> }> = {};
		for (const dataType of ['charge_state', 'vehicle_state', 'drive_state'] as const) {
			const rows = await db.query.sensorEvents.findMany({
				where: and(eq(sensorEvents.sensorId, sensor.id), eq(sensorEvents.dataType, dataType)),
				orderBy: [desc(sensorEvents.timestamp)],
				limit: 1
			});
			if (rows[0]) {
				latestByType[dataType] = {
					timestamp: rows[0].timestamp,
					data: (rows[0].data ?? {}) as Record<string, unknown>
				};
			}
		}

		if (Object.keys(latestByType).length === 0) {
			return {
				success: false,
				message: 'Ingen Tesla-data lagret ennå. Be brukeren synke under Kilder, eller bruk forceLive.'
			};
		}

		return {
			success: true,
			data: {
				source: 'stored',
				name: sensor.name,
				charge: latestByType.charge_state ?? null,
				vehicle: latestByType.vehicle_state ?? null,
				drive: latestByType.drive_state ?? null
			}
		};
	}
};
