import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getRoutesWithEffort,
	isRouteKind,
	upsertRouteFromEkko,
	type EkkoRouteInput
} from '$lib/server/tracks/routes-repository';

/**
 * Ekko-rute-synk (retning: Ekko → Resonans). Ekko eier GPS-rutene og pusher
 * lista hit; Resonans lagrer fakta og eier fartsvariantene (effort per variant
 * beregnes server-side). Se docs/changelog/2026-07-05-treningslop.md
 * (overleveringen) + ekko/ROUTES_API.md.
 *
 * Auth: `Bearer rsn_…` (locals.userId settes av hooks for /api/apps/*).
 */

function toInt(value: unknown): number | null {
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** GET: hele rutebiblioteket med beregnet effort per variant. */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	// easyPace er ukjent i API-konteksten → flat MET-intensitet (Ekko viser
	// relativ effort mellom variantene, ikke absolutt kalibrert mot pace).
	const routes = await getRoutesWithEffort(userId, null);
	return json({ routes });
};

/**
 * POST: idempotent upsert av Ekkos ruteliste på `(userId, ekkoRouteId)`.
 * Bevarer brukerens fartsvarianter; sletter aldri manuelle ruter.
 * Body: `{ routes: [{ ekkoRouteId, name, kind, distanceMeters?, elevationMeters?, terrain? }] }`.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { routes?: unknown } | null;
	const incoming = Array.isArray(body?.routes) ? body!.routes : null;
	if (!incoming) return json({ error: 'Mangler routes[]' }, { status: 400 });

	const results: Array<{ ekkoRouteId: string; id: string; created: boolean }> = [];
	const skipped: Array<{ index: number; reason: string }> = [];

	for (let i = 0; i < incoming.length; i++) {
		const r = (incoming[i] ?? {}) as Record<string, unknown>;
		const ekkoRouteId = typeof r.ekkoRouteId === 'string' ? r.ekkoRouteId.trim() : '';
		const name = typeof r.name === 'string' ? r.name.trim() : '';
		if (!ekkoRouteId || !name) {
			skipped.push({ index: i, reason: 'mangler ekkoRouteId eller name' });
			continue;
		}
		if (!isRouteKind(r.kind)) {
			skipped.push({ index: i, reason: `ugyldig kind: ${String(r.kind)}` });
			continue;
		}

		const input: EkkoRouteInput = {
			ekkoRouteId,
			name,
			kind: r.kind,
			distanceMeters: toInt(r.distanceMeters),
			elevationMeters: toInt(r.elevationMeters),
			terrain: typeof r.terrain === 'string' && r.terrain.trim() ? r.terrain.trim() : null
		};

		try {
			const { row, created } = await upsertRouteFromEkko(userId, input, null);
			results.push({ ekkoRouteId, id: row.id, created });
		} catch (err) {
			skipped.push({ index: i, reason: err instanceof Error ? err.message : 'ukjent feil' });
		}
	}

	return json({
		ok: true,
		imported: results.length,
		created: results.filter((r) => r.created).length,
		updated: results.filter((r) => !r.created).length,
		routes: results,
		skipped
	});
};
