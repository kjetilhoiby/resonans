import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { queryCanonicalTransactions } from './categorized-events';
import { getTeslaSensor } from './tesla-sync';

/**
 * Avledede kjøretøy-metrikker fra Tesla-snapshots:
 *  - Kjørt distanse per klokketime (kronologisk tidsserie).
 *  - Kost per km per måned = (variable bilutgifter + faste bilkostnader) / km.
 *
 * De rene funksjonene under er enkle å teste (ingen DB). `loadVehicleMetrics`
 * er en tynn loader som henter rådata og delegerer til dem.
 *
 * Forbehold (bevisst, dokumentert):
 *  - Kjørt distanse avledes som odometer-delta mellom to målinger, tilskrevet
 *    SLUTT-målingens time (da vi observerte endringen). Cron synker hvert 15.
 *    min 05–22 UTC — nattkjøring lander derfor i morgentimen.
 *  - Kost/km trenger minst én måned odometer-historikk + kategoriserte
 *    transaksjoner før den blir meningsfull; tidlige måneder kan være delvise.
 */

// Kategorier som regnes som bilkostnad. `bil_og_transport` fanger lading på
// betal-ladere (under «drivstoff»), bom, parkering, verksted m.m.;
// `bilforsikring_og_billan` fanger de faste utgiftene forsikring + billån.
export const VEHICLE_COST_CATEGORIES = ['bil_og_transport', 'bilforsikring_og_billan'] as const;

const MS_PER_DAY = 86_400_000;

// ── Rene hjelpere ────────────────────────────────────────────────────────────

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** ISO-time-bøtte (UTC), f.eks. '2026-06-19T14:00:00.000Z'. */
export function utcHourKey(d: Date): string {
	const t = new Date(d.getTime());
	t.setUTCMinutes(0, 0, 0);
	return t.toISOString();
}

/** Måned-nøkkel (UTC), f.eks. '2026-06'. */
export function utcMonthKey(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface OdometerSample {
	timestamp: Date;
	odometerKm: number;
}

export interface BucketDistance {
	key: string;
	km: number;
}

/**
 * Bøtt kjørt distanse fra odometer-snapshots etter en valgfri nøkkel-funksjon.
 * Distanse i et intervall = positiv odometer-delta, tilskrevet slutt-målingens
 * bøtte. Negative/null-deltaer ignoreres (odometer er monotont stigende).
 */
export function deriveDistanceByBucket(
	samples: OdometerSample[],
	keyFn: (d: Date) => string
): BucketDistance[] {
	const sorted = samples
		.filter((s) => Number.isFinite(s.odometerKm) && !Number.isNaN(s.timestamp.getTime()))
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

	const buckets = new Map<string, number>();
	for (let i = 1; i < sorted.length; i++) {
		const delta = sorted[i].odometerKm - sorted[i - 1].odometerKm;
		if (!(delta > 0)) continue;
		const key = keyFn(sorted[i].timestamp);
		buckets.set(key, (buckets.get(key) ?? 0) + delta);
	}

	return [...buckets.entries()]
		.map(([key, km]) => ({ key, km: round1(km) }))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Kjørt distanse per klokketime (UTC). */
export function deriveHourlyDistance(samples: OdometerSample[]): BucketDistance[] {
	return deriveDistanceByBucket(samples, utcHourKey);
}

/** Kjørt distanse per måned (UTC). */
export function deriveMonthlyDistance(samples: OdometerSample[]): BucketDistance[] {
	return deriveDistanceByBucket(samples, utcMonthKey);
}

export interface MonthCost {
	month: string;
	cost: number;
}

export interface CostPerKmPoint {
	month: string;
	km: number;
	cost: number;
	krPerKm: number | null; // null når km = 0 (udefinert)
}

/**
 * Slå sammen månedlig kjørt distanse og månedlig bilkostnad til kr/km.
 * Måneder uten kjøring får `krPerKm = null` (udefinert, ikke 0).
 */
export function computeCostPerKm(
	monthlyKm: BucketDistance[],
	monthlyCost: MonthCost[]
): CostPerKmPoint[] {
	const kmByMonth = new Map(monthlyKm.map((m) => [m.key, m.km]));
	const costByMonth = new Map(monthlyCost.map((m) => [m.month, m.cost]));
	const months = [...new Set([...kmByMonth.keys(), ...costByMonth.keys()])].sort();

	return months.map((month) => {
		const km = kmByMonth.get(month) ?? 0;
		const cost = costByMonth.get(month) ?? 0;
		return {
			month,
			km: round1(km),
			cost: round1(cost),
			krPerKm: km > 0 ? round2(cost / km) : null
		};
	});
}

// ── Loader (DB) ──────────────────────────────────────────────────────────────

export interface VehicleMetrics {
	connected: boolean;
	hourly: BucketDistance[];
	costPerKm: CostPerKmPoint[];
	generatedAt: string;
}

function startOfUtcMonth(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Hent kjøretøy-metrikker for en bruker. Henter odometer-snapshots
 * (`vehicle_state`) og bilrelaterte transaksjoner, og avleder grafene.
 */
export async function loadVehicleMetrics(
	userId: string,
	opts: { hourlyDays?: number; costMonths?: number } = {},
	now: Date = new Date()
): Promise<VehicleMetrics> {
	const { hourlyDays = 7, costMonths = 6 } = opts;

	const sensor = await getTeslaSensor(userId);
	if (!sensor) {
		return { connected: false, hourly: [], costPerKm: [], generatedAt: now.toISOString() };
	}

	const hourlyFrom = new Date(now.getTime() - hourlyDays * MS_PER_DAY);
	const costFrom = startOfUtcMonth(
		new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (costMonths - 1), 1))
	);
	const fetchFrom = costFrom < hourlyFrom ? costFrom : hourlyFrom;

	// Odometer-snapshots fra vehicle_state.
	const rows = await db
		.select({
			timestamp: sensorEvents.timestamp,
			odometerKm: sql<number>`(data->>'odometerKm')::numeric`
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.sensorId, sensor.id),
				eq(sensorEvents.dataType, 'vehicle_state'),
				sql`data ? 'odometerKm'`,
				sql`${sensorEvents.timestamp} >= ${fetchFrom.toISOString()}`
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const samples: OdometerSample[] = rows
		.map((r) => ({ timestamp: r.timestamp, odometerKm: Number(r.odometerKm) }))
		.filter((s) => Number.isFinite(s.odometerKm));

	// Timesgraf: regn ut over alle hentede prøver (så første bøtte i vinduet får
	// sin delta fra forrige prøve), filtrer deretter til vinduet.
	const hourly = deriveHourlyDistance(samples).filter((b) => b.key >= hourlyFrom.toISOString());

	// Månedskm for kost/km.
	const monthlyKm = deriveMonthlyDistance(samples).filter((b) => b.key >= utcMonthKey(costFrom));

	// Bilrelaterte utgifter per måned (negative beløp = forbruk).
	const txnLists = await Promise.all(
		VEHICLE_COST_CATEGORIES.map((category) =>
			queryCanonicalTransactions({ userId, from: costFrom, to: now, category, spendingOnly: true })
		)
	);
	const costByMonth = new Map<string, number>();
	for (const txn of txnLists.flat()) {
		const month = utcMonthKey(txn.timestamp);
		costByMonth.set(month, (costByMonth.get(month) ?? 0) + Math.abs(txn.amount));
	}
	const monthlyCost: MonthCost[] = [...costByMonth.entries()].map(([month, cost]) => ({
		month,
		cost
	}));

	const costPerKm = computeCostPerKm(monthlyKm, monthlyCost);

	return { connected: true, hourly, costPerKm, generatedAt: now.toISOString() };
}
