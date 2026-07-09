import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getRoutesWithEffort,
	isRouteKind,
	upsertRouteFromEkko,
	type EkkoRouteInput
} from '$lib/server/tracks/routes-repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';

/** Easy-pace-referanse for effort-beregning — fra utøverens pace-soner (VDOT). */
async function easyPaceOf(userId: string): Promise<number | null> {
	const snapshot = await buildAthleteSnapshot(userId).catch(() => null);
	return snapshot?.paceZones?.easySecPerKm ?? null;
}

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

	// Effort må regnes mot brukerens FAKTISKE easy-pace — uten referanse ville
	// seedede varianter servert frosne farter fra opprettelsestidspunktet.
	const routes = await getRoutesWithEffort(userId, await easyPaceOf(userId));
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
	// Nye ruter seedes med varianter forankret i brukerens faktiske easy-pace
	// (paceFactor gjør dem uansett selvjusterende ved senere formendring).
	const easyPace = await easyPaceOf(userId);

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
			const { row, created } = await upsertRouteFromEkko(userId, input, easyPace);
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
