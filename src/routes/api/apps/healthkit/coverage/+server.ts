/**
 * GET /api/apps/healthkit/coverage?types=weight,workout,sleep&from=YYYY-MM-DD
 *
 * Hvilke Oslo-dager Resonans allerede har data for. Ekko trekker dette fra sin egen
 * HealthKit-historikk for å svare på «hva er nytt?» — spørsmålet appen ikke kan
 * besvare alene, og som ellers gjør en importknapp til et sjansespill.
 *
 * Leser bare. Skriver ingenting.
 *
 * ## Om den rå lesingen
 *
 * Fila leser `weight`, `workout` og `sleep` rått, og det er riktig her: spørsmålet er
 * om en rad *finnes* på en dag, ikke hva den måler. Dobbelttellingen de delte leserne
 * finnes for å rette endrer ikke om dagen har en rad — og en delt leser ville kostet
 * en full tolkning av hele historikken for et eksistensspørsmål.
 *
 * **Vakten i `sensor-event-access.ts` ser den ikke.** Detektoren leter etter
 * typenavnet som en literal ved siden av `dataType`, og her kommer lista fra
 * `COVERAGE_TYPES` gjennom en variabel. Begrunnelsen står derfor her framfor i
 * `knownRawReaders` — en oppføring der ville feilet «lista skal krympe»-testen, siden
 * fila ikke matcher mønsteret. Det er en kjent blindsone i vakten: en fil som legger
 * typenavnene i en konstant slipper unna. Utvides detektoren senere, hører denne fila
 * hjemme i lista med teksten over.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import {
	buildCoverage,
	parseCoverageTypes,
	type CoverageType,
	type TypeCoverage
} from '$lib/domain/health/healthkit-coverage';

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { types, unknown } = parseCoverageTypes(url.searchParams.get('types'));
	if (unknown.length > 0) {
		return json(
			{ error: `Ukjente typer: ${unknown.join(', ')}`, known: ['weight', 'workout', 'sleep'] },
			{ status: 400 }
		);
	}
	if (types.length === 0) {
		return json({ error: 'Ingen gyldige typer oppgitt' }, { status: 400 });
	}

	const fromParam = url.searchParams.get('from');
	let from: Date | null = null;
	if (fromParam) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
			return json({ error: 'Ugyldig "from" — forventer YYYY-MM-DD' }, { status: 400 });
		}
		// Et døgn padding: Oslo-døgnet krysser UTC-midnatt, så en rad som hører til
		// `from` i Oslo kan ha et tidsstempel på UTC-dagen før.
		from = new Date(`${fromParam}T00:00:00.000Z`);
		from.setUTCDate(from.getUTCDate() - 1);
	}

	try {
		const conditions = [eq(sensorEvents.userId, userId), inArray(sensorEvents.dataType, types)];
		if (from) conditions.push(gte(sensorEvents.timestamp, from));

		const rows = await db
			.select({ dataType: sensorEvents.dataType, timestamp: sensorEvents.timestamp })
			.from(sensorEvents)
			.where(and(...conditions));

		const byType = new Map<CoverageType, Array<{ timestamp: Date }>>();
		for (const type of types) byType.set(type, []);
		for (const row of rows) {
			byType.get(row.dataType as CoverageType)?.push({ timestamp: row.timestamp });
		}

		const coverage: Record<string, TypeCoverage> = {};
		for (const type of types) {
			coverage[type] = buildCoverage(byType.get(type) ?? [], type);
		}

		console.log(
			`[healthkit-coverage] user=${userId} types=${types.join(',')} rows=${rows.length} ` +
				types.map((t) => `${t}=${coverage[t].totalDays}d`).join(' ')
		);

		return json({ from: fromParam ?? null, types: coverage });
	} catch (err) {
		console.error('[healthkit-coverage] failed:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Coverage failed' },
			{ status: 500 }
		);
	}
};
