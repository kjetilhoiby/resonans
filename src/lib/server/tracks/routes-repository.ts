import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { trainingRoutes } from '$lib/db/schema';
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
 *  - Finnes ruten fra før: oppdater fakta, men BEVAR brukerens `variants`.
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
				kind: input.kind,
				distanceMeters: input.distanceMeters ?? null,
				elevationMeters: input.elevationMeters ?? null,
				// Terreng fra Ekko når oppgitt, ellers behold det brukeren evt. satte.
				terrain: input.terrain ?? existing[0].terrain,
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

export async function archiveRoute(userId: string, routeId: string): Promise<boolean> {
	const result = await db
		.update(trainingRoutes)
		.set({ archived: true, updatedAt: new Date() })
		.where(and(eq(trainingRoutes.id, routeId), eq(trainingRoutes.userId, userId)))
		.returning({ id: trainingRoutes.id });
	return result.length > 0;
}
