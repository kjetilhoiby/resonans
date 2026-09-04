import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	importStravaBatch,
	type ImportFile
} from '$lib/server/workouts/strava-import';
import {
	parseStravaManifest,
	StravaManifestError,
	type StravaManifestRow
} from '$lib/domain/health/strava-export';
import type { PaceReference } from '$lib/domain/health/import-triage';

/**
 * POST /api/sensors/strava-import
 *
 * Importerer én BATCH av en Strava-arkiveksport. Se
 * `docs/changelog/2026-09-04-strava-arkivimport.md`.
 *
 * ## Hvorfor en batch, og ikke zipen
 *
 * Zipen er 38 MB og inneholder 1020 spor. Serveren kunne tatt den — vi hevet
 * `BODY_SIZE_LIMIT` til 100M — men da måtte den enten holde alle sporene i
 * minnet samtidig (hundrevis av MB) eller få zipen sendt på nytt for hver
 * runde (38 MB × 20 runder). Klienten pakker den derfor ut i NETTLESEREN og
 * sender filene i porsjoner; se `StravaImportCard`. Løkka i klienten er samme
 * grep som `WorkoutReanalyzeCard`, og av samme grunn: en serverside-løkke
 * ville truffet svartidsgrensa, og en halvferdig jobb uten framdriftstall er
 * verre enn en som teller.
 *
 * ## Kroppen
 *
 * `multipart/form-data`:
 * - `manifest` — CSV-teksten fra `activities.csv`, eller en JSON-liste med
 *   ferdig parsede rader (`rows`). CSV-en er den ærlige veien: da parses den
 *   ETT sted, av modulen som har testene.
 * - `ids` — JSON-liste over hvilke aktivitets-id-er denne batchen dekker.
 * - `file:<aktivitetsId>` — én fil per id, som den ligger i zipen (`.gz` og alt).
 * - `pr` (valgfri) — `meter:sekunder`, brukerens egen tempo-referanse.
 * - `dryRun` (valgfri) — dømmer og rapporterer uten å skrive.
 *
 * ## `pr` er ikke pynt
 *
 * Uten den er `for-rask`-aksen AV, og en sykkeltur merket «Run» går rett inn i
 * distanserekordene. Endepunktet svarer derfor med `paceReferenceUsed`, så en
 * import kjørt uten referanse ikke ser identisk ut med en kjørt med.
 */

function parsePaceReference(raw: string | null): PaceReference | null {
	if (!raw) return null;
	const [meters, seconds] = raw.split(':').map(Number);
	if (!Number.isFinite(meters) || !Number.isFinite(seconds) || meters <= 0 || seconds <= 0) {
		return null;
	}
	return { distanceMeters: meters, seconds };
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let form: FormData;
	try {
		form = await request.formData();
	} catch (error) {
		// En kropp over grensa dør her, og meldingen skal navngi grensa —
		// «Failed to parse body» er uløselig for den som sitter med zipen.
		const message = error instanceof Error ? error.message : 'Ukjent feil';
		return json(
			{ error: `Klarte ikke lese forespørselen (er batchen for stor?): ${message}` },
			{ status: 400 }
		);
	}

	const manifestCsv = form.get('manifest');
	const rowsJson = form.get('rows');

	let allRows: StravaManifestRow[];
	try {
		if (typeof manifestCsv === 'string' && manifestCsv.trim() !== '') {
			allRows = parseStravaManifest(manifestCsv);
		} else if (typeof rowsJson === 'string' && rowsJson.trim() !== '') {
			allRows = JSON.parse(rowsJson) as StravaManifestRow[];
		} else {
			return json(
				{ error: 'Mangler «manifest» (activities.csv som tekst) eller «rows» (JSON).' },
				{ status: 400 }
			);
		}
	} catch (error) {
		const message =
			error instanceof StravaManifestError
				? error.message
				: error instanceof Error
					? error.message
					: 'Ukjent feil';
		return json({ error: message }, { status: 400 });
	}

	const idsRaw = form.get('ids');
	let ids: string[];
	if (typeof idsRaw === 'string' && idsRaw.trim() !== '') {
		try {
			ids = JSON.parse(idsRaw) as string[];
		} catch {
			return json({ error: '«ids» er ikke gyldig JSON.' }, { status: 400 });
		}
	} else {
		// Uten `ids` importeres alt manifestet beskriver som filene dekker.
		// Praktisk for et enkeltkall; klienten sender alltid `ids`.
		ids = allRows.map((r) => r.id);
	}

	const wanted = new Set(ids);
	const rows = allRows.filter((r) => wanted.has(r.id));
	if (rows.length === 0) {
		return json({ error: 'Ingen av de oppgitte id-ene finnes i manifestet.' }, { status: 400 });
	}

	const files: ImportFile[] = [];
	for (const id of ids) {
		const entry = form.get(`file:${id}`);
		if (entry instanceof File) {
			files.push({ id, bytes: new Uint8Array(await entry.arrayBuffer()) });
		}
	}

	const paceReference = parsePaceReference(
		typeof form.get('pr') === 'string' ? (form.get('pr') as string) : url.searchParams.get('pr')
	);
	const dryRun = form.get('dryRun') === 'true' || url.searchParams.get('dryRun') === 'true';

	try {
		const result = await importStravaBatch({
			userId,
			rows,
			files,
			paceReference: paceReference ?? undefined,
			appUrl: url.origin,
			dryRun
		});

		return json({
			...result,
			dryRun,
			requested: rows.length,
			filesReceived: files.length,
			// Sies eksplisitt: uten referanse er for-rask-aksen AV, og da ser en
			// import uten den identisk ut med en som ikke fant noe.
			paceReferenceUsed: paceReference
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Ukjent feil';
		return json({ error: message }, { status: 500 });
	}
};
