import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents, trainingRoutes } from '$lib/db/schema';
import {
	defaultRouteSeeds,
	defaultVariantsForKind,
	routeEffortRange,
	type RouteKind,
	type RouteVariant
} from './routes';

const ROUTE_KINDS: RouteKind[] = ['run', 'bike', 'hill', 'trail', 'mixed'];
export function isRouteKind(value: unknown): value is RouteKind {
	return typeof value === 'string' && (ROUTE_KINDS as string[]).includes(value);
}

export type TrainingRouteRow = typeof trainingRoutes.$inferSelect;

export async function getRoutes(userId: string): Promise<TrainingRouteRow[]> {
	return db
		.select()
		.from(trainingRoutes)
		.where(and(eq(trainingRoutes.userId, userId), eq(trainingRoutes.archived, false)))
		.orderBy(asc(trainingRoutes.sortOrder), asc(trainingRoutes.createdAt));
}

/** Ruter med beregnet effort per variant — klare til visning/forslag. */
export async function getRoutesWithEffort(userId: string, easyPaceSecPerKm: number | null) {
	const routes = await getRoutes(userId);
	return routes.map((r) => ({
		id: r.id,
		name: r.name,
		kind: r.kind as RouteKind,
		distanceMeters: r.distanceMeters,
		elevationMeters: r.elevationMeters,
		terrain: r.terrain,
		notes: r.notes,
		...routeEffortRange(
			{
				kind: r.kind as RouteKind,
				distanceMeters: r.distanceMeters,
				elevationMeters: r.elevationMeters,
				variants: r.variants ?? []
			},
			easyPaceSecPerKm
		)
	}));
}

/** Seeder startruter én gang per bruker (idempotent — hopper over hvis noen finnes). */
export async function seedDefaultRoutes(userId: string, easyPaceSecPerKm: number | null): Promise<void> {
	const existing = await db
		.select({ id: trainingRoutes.id })
		.from(trainingRoutes)
		.where(eq(trainingRoutes.userId, userId))
		.limit(1);
	if (existing.length > 0) return;

	const seeds = defaultRouteSeeds(easyPaceSecPerKm);
	await db.insert(trainingRoutes).values(
		seeds.map((s, i) => ({
			userId,
			name: s.name,
			kind: s.kind,
			distanceMeters: s.distanceMeters,
			elevationMeters: s.elevationMeters,
			terrain: s.terrain,
			variants: s.variants,
			sortOrder: i
		}))
	);
}

export interface CreateRouteInput {
	name: string;
	kind: RouteKind;
	distanceMeters?: number | null;
	elevationMeters?: number | null;
	terrain?: string | null;
	notes?: string | null;
	variants: RouteVariant[];
}

export async function createRoute(userId: string, input: CreateRouteInput): Promise<TrainingRouteRow> {
	const maxOrder = await db
		.select({ sortOrder: trainingRoutes.sortOrder })
		.from(trainingRoutes)
		.where(eq(trainingRoutes.userId, userId))
		.orderBy(asc(trainingRoutes.sortOrder));
	const nextOrder = maxOrder.length > 0 ? (maxOrder[maxOrder.length - 1].sortOrder ?? 0) + 1 : 0;

	const [row] = await db
		.insert(trainingRoutes)
		.values({
			userId,
			name: input.name,
			kind: input.kind,
			distanceMeters: input.distanceMeters ?? null,
			elevationMeters: input.elevationMeters ?? null,
			terrain: input.terrain ?? null,
			notes: input.notes ?? null,
			variants: input.variants,
			sortOrder: nextOrder
		})
		.returning();
	return row;
}

export interface EkkoRouteInput {
	ekkoRouteId: string;
	name: string;
	kind: RouteKind;
	distanceMeters?: number | null;
	elevationMeters?: number | null;
	terrain?: string | null;
}

/**
 * Upsert av en rute fra Ekko på `(user_id, ekko_route_id)`. Ekko eier geometri/
 * fakta (navn, distanse, høyde, terreng); Resonans eier fartsvariantene:
 *  - Finnes ruten fra før: oppdater ren geometri (distanse/høyde/navn), men
 *    BEVAR brukerens `variants`, `kind` og `terrain` (Resonans-eid tolkning —
 *    Ekkos sportType er grov, så en rute raffinert til «sti» i Resonans skal
 *    ikke klobbes tilbake til «løp» ved neste synk).
 *  - Ny rute: seed default-varianter fra pace (per kind).
 * Manuelle ruter (`ekko_route_id IS NULL`) røres aldri.
 */
export async function upsertRouteFromEkko(
	userId: string,
	input: EkkoRouteInput,
	easyPaceSecPerKm: number | null
): Promise<{ row: TrainingRouteRow; created: boolean }> {
	const existing = await db
		.select()
		.from(trainingRoutes)
		.where(and(eq(trainingRoutes.userId, userId), eq(trainingRoutes.ekkoRouteId, input.ekkoRouteId)))
		.limit(1);

	if (existing[0]) {
		const [updated] = await db
			.update(trainingRoutes)
			.set({
				name: input.name,
				// kind BEVARES (Resonans-eid): en rute raffinert til 'trail' skal ikke
				// klobbes tilbake av Ekkos grove sportType.
				distanceMeters: input.distanceMeters ?? null,
				elevationMeters: input.elevationMeters ?? null,
				// Terreng: behold brukerens verdi, fyll kun inn hvis den mangler.
				terrain: existing[0].terrain ?? input.terrain ?? null,
				archived: false,
				updatedAt: new Date()
			})
			.where(eq(trainingRoutes.id, existing[0].id))
			.returning();
		return { row: updated, created: false };
	}

	const maxOrder = await db
		.select({ sortOrder: trainingRoutes.sortOrder })
		.from(trainingRoutes)
		.where(eq(trainingRoutes.userId, userId))
		.orderBy(asc(trainingRoutes.sortOrder));
	const nextOrder = maxOrder.length > 0 ? (maxOrder[maxOrder.length - 1].sortOrder ?? 0) + 1 : 0;

	const [row] = await db
		.insert(trainingRoutes)
		.values({
			userId,
			name: input.name,
			kind: input.kind,
			distanceMeters: input.distanceMeters ?? null,
			elevationMeters: input.elevationMeters ?? null,
			terrain: input.terrain ?? null,
			variants: defaultVariantsForKind(input.kind, easyPaceSecPerKm),
			ekkoRouteId: input.ekkoRouteId,
			sortOrder: nextOrder
		})
		.returning();
	return { row, created: true };
}

/**
 * Rute-navn per rute-tagget økt siste `sinceDays`, kronologisk — grunnlag for
 * rute-rotasjons-nudgen i balanse-signalet. Leser `ekkoRouteId` fra
 * `sensor_events.metadata` (Ekko tagger opplastede økter) og mapper til rutenavn.
 * Returnerer [] når biblioteket har < 2 ruter (ingen å variere til) eller ingen
 * økter er rute-tagget ennå — da gir balansen ingen rotasjons-nudge.
 */
export async function getRecentRouteLabels(userId: string, sinceDays: number): Promise<string[]> {
	const routes = await db
		.select({ ekkoRouteId: trainingRoutes.ekkoRouteId, name: trainingRoutes.name })
		.from(trainingRoutes)
		.where(and(eq(trainingRoutes.userId, userId), eq(trainingRoutes.archived, false)));
	if (routes.length < 2) return [];

	const nameByEkkoId = new Map<string, string>();
	for (const r of routes) if (r.ekkoRouteId) nameByEkkoId.set(r.ekkoRouteId, r.name);
	if (nameByEkkoId.size === 0) return [];

	const since = new Date(Date.now() - sinceDays * 24 * 3600_000);
	const rows = await db
		.select({ timestamp: sensorEvents.timestamp, metadata: sensorEvents.metadata })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				gte(sensorEvents.timestamp, since),
				inArray(sensorEvents.dataType, ['workout', 'strength_workout'])
			)
		)
		.orderBy(asc(sensorEvents.timestamp));

	const labels: string[] = [];
	for (const row of rows) {
		const meta = (row.metadata ?? {}) as Record<string, unknown>;
		const ekkoRouteId = typeof meta.ekkoRouteId === 'string' ? meta.ekkoRouteId : null;
		if (!ekkoRouteId) continue;
		const name = nameByEkkoId.get(ekkoRouteId);
		if (name) labels.push(name);
	}
	return labels;
}

export async function archiveRoute(userId: string, routeId: string): Promise<boolean> {
	const result = await db
		.update(trainingRoutes)
		.set({ archived: true, updatedAt: new Date() })
		.where(and(eq(trainingRoutes.id, routeId), eq(trainingRoutes.userId, userId)))
		.returning({ id: trainingRoutes.id });
	return result.length > 0;
}
