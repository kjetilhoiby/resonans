/**
 * DELETE /api/helse/vekt/maalinger/[id]
 *
 * Sletter én vektmåling. For veiinger som målte noe annet enn brukeren — et barn på
 * vekta, en bag, en sensorglipp.
 *
 * ## Hvorfor sletting, og ikke skjuling
 *
 * En rad vi bare gjemmer for grafen er fortsatt med i snitt, milepæler,
 * energibalanse og målprogresjon. Da sier flaten og regnestykkene ulike ting, og det
 * er en verre tilstand enn den vi startet i. Raden skal bort.
 *
 * ## Hvorfor det er trygt at dette er en hard sletting
 *
 * Synken er additiv og henter fra `lastSync` og framover, så en gammel rad kommer
 * ikke tilbake av seg selv. Kommer den fra Withings eller Apple Health og *ikke* er
 * slettet der, vil en full sync eller en ny backfill hente den inn igjen — det er
 * ikke en feil i sletting, men en grunn til å rydde i kilden også. Svaret sier det.
 *
 * Hele raden logges før den forsvinner, så en feilsletting kan finnes igjen i
 * Vercel-loggen og legges inn på nytt.
 *
 * `[id=uuid]` bruker ruteparameter-matcheren: uten den gir et ikke-uuid segment 500
 * fra Postgres der svaret er 404.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const existing = await db.query.sensorEvents.findFirst({
			where: and(eq(sensorEvents.id, params.id), eq(sensorEvents.userId, userId))
		});

		if (!existing) {
			return json({ error: 'Fant ikke målingen' }, { status: 404 });
		}
		// Endepunktet sletter vektmålinger. Et id-treff på en søvnrad eller en
		// banktransaksjon er en feil hos kalleren, ikke noe vi skal utføre.
		if (existing.dataType !== 'weight') {
			return json(
				{ error: `Raden er ikke en vektmåling (data_type: ${existing.dataType})` },
				{ status: 409 }
			);
		}

		console.log(
			`[vekt-maalinger] sletter id=${existing.id} user=${userId} ` +
				`timestamp=${existing.timestamp.toISOString()} sensor=${existing.sensorId} ` +
				`data=${JSON.stringify(existing.data)} metadata=${JSON.stringify(existing.metadata)}`
		);

		await db
			.delete(sensorEvents)
			.where(and(eq(sensorEvents.id, params.id), eq(sensorEvents.userId, userId)));

		return json({
			ok: true,
			slettet: {
				id: existing.id,
				timestamp: existing.timestamp.toISOString(),
				weight: (existing.data as { weight?: number } | null)?.weight ?? null
			},
			// Konsekvensen skal sies, ikke oppdages: er kilden ikke ryddet, kommer
			// målingen tilbake ved neste fulle sync eller backfill.
			merknad:
				'Slett målingen i kilden også (Withings / Apple Helse), ellers kan den komme tilbake ved en full synk eller en ny backfill.'
		});
	} catch (err) {
		console.error('[vekt-maalinger] delete failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};
