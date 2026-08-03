import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { LoggedEntry } from '$lib/domain/nutrition/day-summary';
import type { NutritionEstimate } from '$lib/domain/nutrition/estimate';
import {
	isMealSlotId,
	mealSlotForTime,
	reslotAfterTimeChange,
	type MealSlotId
} from '$lib/domain/nutrition/meal-slots';

/**
 * Inntaksloggen.
 *
 * Den bor i `sensor_events` framfor en egen tabell, fordi hele pipelinen henger
 * på det: `sensor_aggregates` bygges fra sensorhendelser, signalene leser
 * aggregatene, og AI-konteksten leser signalene. En egen `nutrition_entries`-
 * tabell ville krevd nye ledd i hvert av de tre stegene for å gi samme verdi.
 *
 * Kilden registreres som en `manual`/`nutrition_log`-sensor. Typen holder den
 * utenfor helse- og treningsspørringene, som filtrerer på `health_tracker` og
 * `workout_files` — så loggen forurenser ikke aktivitetslista.
 */

export const NUTRITION_PROVIDER = 'manual';
export const NUTRITION_SENSOR_TYPE = 'nutrition_log';
export const NUTRITION_DATA_TYPE = 'nutrition';

/**
 * Finner eller oppretter brukerens ernæringssensor.
 *
 * Opprettes ved første logging, ikke ved første sidevisning: en bruker som aldri
 * logger skal ikke få en sensorrad som ser ut som en koblet kilde i
 * `/settings/sources` og i friskhetsovervåkingen.
 */
export async function ensureNutritionSensor(userId: string): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, NUTRITION_PROVIDER),
			eq(sensors.type, NUTRITION_SENSOR_TYPE)
		)
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: NUTRITION_PROVIDER,
			type: NUTRITION_SENSOR_TYPE,
			subtype: 'intake',
			name: 'Ernæringslogg',
			isActive: true
		})
		.returning({ id: sensors.id });

	return created.id;
}

/** Sensor-id-ene loggen bruker. Tom liste når brukeren ikke har logget ennå. */
async function nutritionSensorIds(userId: string): Promise<string[]> {
	const rows = await db.query.sensors.findMany({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, NUTRITION_PROVIDER),
			eq(sensors.type, NUTRITION_SENSOR_TYPE)
		)
	});
	return rows.map((row) => row.id);
}

function estimateToEventData(
	estimate: NutritionEstimate,
	extra: {
		imageUrl?: string | null;
		descriptions: string[];
		mealSlot: MealSlotId | null;
		mealSlotSource: 'derived' | 'user' | null;
	}
) {
	return {
		// Flate makroer først: aggregeringen leser disse direkte, på samme måte
		// som den leser `weight` og `sleepDuration` fra andre kilder.
		kcal: estimate.totals.kcal,
		proteinG: estimate.totals.proteinG,
		carbsG: estimate.totals.carbsG,
		fatG: estimate.totals.fatG,
		mealLabel: estimate.label,
		items: estimate.items,
		confidence: estimate.confidence,
		estimateSource: estimate.source,
		descriptions: extra.descriptions,
		...(extra.mealSlot ? { mealSlot: extra.mealSlot, mealSlotSource: extra.mealSlotSource ?? 'derived' } : {}),
		...(extra.imageUrl ? { imageUrl: extra.imageUrl } : {})
	};
}

export interface LogIntakeInput {
	userId: string;
	estimate: NutritionEstimate;
	/** Når måltidet ble spist. Standard nå. */
	timestamp?: Date;
	imageUrl?: string | null;
	/** Brukerens egne beskrivelser, eldste først. */
	descriptions?: string[];
	/**
	 * Måltidsslot. Utledes fra tidspunktet når den ikke er oppgitt — det er
	 * standarden, og den skal kunne overstyres uten å legge et trykk på den
	 * raske veien inn.
	 */
	mealSlot?: MealSlotId | null;
}

export async function logIntake(input: LogIntakeInput): Promise<{ id: string; timestamp: string }> {
	const sensorId = await ensureNutritionSensor(input.userId);
	const timestamp = input.timestamp ?? new Date();

	const chosenSlot = input.mealSlot ?? null;
	const slot = chosenSlot ?? mealSlotForTime(timestamp);

	const [created] = await db
		.insert(sensorEvents)
		.values({
			userId: input.userId,
			sensorId,
			eventType: 'measurement',
			dataType: NUTRITION_DATA_TYPE,
			timestamp,
			data: estimateToEventData(input.estimate, {
				imageUrl: input.imageUrl,
				descriptions: input.descriptions ?? [],
				mealSlot: slot,
				mealSlotSource: chosenSlot ? 'user' : 'derived'
			}),
			metadata: { source: 'nutrition-logger' }
		})
		.returning({ id: sensorEvents.id, timestamp: sensorEvents.timestamp });

	return { id: created.id, timestamp: created.timestamp.toISOString() };
}

/**
 * Retter et loggført måltid: tidspunkt, slot, tittel og/eller makroer.
 *
 * Alt er valgfritt — dette er en delvis oppdatering. Å kreve alle fire makroene
 * for å flytte et måltid fra 13 til 11 ville tvunget klienten til å sende
 * tilbake tall den ikke rørte.
 *
 * `userAdjusted` settes når makroene rettes, slik at en senere re-estimering
 * ikke overskriver brukerens egne tall. Varelista beholdes — den forklarer hvor
 * estimatet kom fra, og å slette den ville gjort rettelsen usporbar.
 *
 * Returnerer forrige og nytt tidspunkt, fordi kallstedet må re-aggregere BEGGE
 * periodene når et måltid flyttes over en uke- eller månedsgrense.
 */
export interface UpdateIntakeInput {
	timestamp?: Date;
	mealSlot?: MealSlotId;
	label?: string;
	macros?: { kcal: number; proteinG: number; carbsG: number; fatG: number };
}

export async function updateIntake(
	userId: string,
	eventId: string,
	input: UpdateIntakeInput
): Promise<{ previousTimestamp: Date; timestamp: Date } | null> {
	const existing = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, eventId),
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, NUTRITION_DATA_TYPE)
		)
	});
	if (!existing) return null;

	const previousTimestamp = existing.timestamp;
	const data = { ...(existing.data ?? {}) } as Record<string, unknown>;

	const timestamp = input.timestamp ?? previousTimestamp;

	// Slot: eksplisitt valg vinner. Ellers følger en utledet slot det nye
	// tidspunktet, mens et tidligere brukervalg står.
	if (input.mealSlot) {
		data.mealSlot = input.mealSlot;
		data.mealSlotSource = 'user';
	} else if (input.timestamp) {
		const current = {
			slot: isMealSlotId(data.mealSlot) ? data.mealSlot : null,
			source:
				data.mealSlotSource === 'user' || data.mealSlotSource === 'derived'
					? (data.mealSlotSource as 'user' | 'derived')
					: null
		};
		const next = reslotAfterTimeChange(timestamp, current);
		if (next.slot) {
			data.mealSlot = next.slot;
			data.mealSlotSource = next.source ?? 'derived';
		}
	}

	if (input.label) data.mealLabel = input.label;
	if (input.macros) {
		Object.assign(data, input.macros);
		data.userAdjusted = true;
	}

	await db
		.update(sensorEvents)
		.set({ data, timestamp })
		.where(eq(sensorEvents.id, eventId));

	return { previousTimestamp, timestamp };
}

/** Sletter et loggført måltid. Returnerer false når det ikke finnes. */
export async function deleteIntake(userId: string, eventId: string): Promise<boolean> {
	const deleted = await db
		.delete(sensorEvents)
		.where(
			and(
				eq(sensorEvents.id, eventId),
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, NUTRITION_DATA_TYPE)
			)
		)
		.returning({ id: sensorEvents.id });

	return deleted.length > 0;
}

/**
 * Loggen i et tidsvindu, nyeste først.
 *
 * `userAdjusted`-rettelser ligger i de flate makrofeltene, så leseren trenger
 * ikke vite om et måltid er korrigert — tallene er allerede de riktige.
 */
export async function listIntake(
	userId: string,
	opts: { since?: Date; until?: Date; limit?: number } = {}
): Promise<LoggedEntry[]> {
	const sensorIds = await nutritionSensorIds(userId);
	if (sensorIds.length === 0) return [];

	const conditions = [eq(sensorEvents.userId, userId), inArray(sensorEvents.sensorId, sensorIds)];
	if (opts.since) conditions.push(gte(sensorEvents.timestamp, opts.since));
	if (opts.until) conditions.push(lte(sensorEvents.timestamp, opts.until));

	const rows = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(and(...conditions))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(opts.limit ?? 200);

	return rows.map((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
		return {
			id: row.id,
			timestamp: row.timestamp.toISOString(),
			label: typeof data.mealLabel === 'string' && data.mealLabel ? data.mealLabel : 'Måltid',
			macros: {
				kcal: num(data.kcal),
				proteinG: num(data.proteinG),
				carbsG: num(data.carbsG),
				fatG: num(data.fatG)
			},
			confidence: typeof data.confidence === 'number' ? data.confidence : 0,
			imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
			mealSlot: isMealSlotId(data.mealSlot) ? data.mealSlot : null,
			mealSlotSource:
				data.mealSlotSource === 'user' || data.mealSlotSource === 'derived'
					? data.mealSlotSource
					: null
		};
	});
}
