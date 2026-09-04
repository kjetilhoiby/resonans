/**
 * Strava-eksporten: manifestet er autoritet for metadata, fila for SPORET.
 *
 * Arbeidsdelingen er ikke en preferanse — den er en rettelse. `parseGpx` i
 * `dropbox-sync.ts` hardkoder `sportType: 'running'`, fordi den ble skrevet for
 * en mappe som bare inneholdt løpeturer. Arkivet har 367 sykkelturer og 63
 * elsykkelturer, og de fleste av dem ligger som `.gpx.gz`. Importert gjennom
 * parseren alene ville de blitt ~400 løpeøkter — altså nøyaktig forgiftningen
 * `for-rask`-aksen i `import-triage.ts` finnes for å fange, levert med vilje.
 *
 * Samme grunn gjelder DISTANSE og VARIGHET: `parseGpx` summerer haversine
 * mellom nabopunkter, som legger sammen GPS-støyen (se `moving-time.ts` —
 * «sporlengde summerer GPS-støyen; står man stille spriker punktene 2–5
 * meter»). Manifestet bærer Stravas egne tall, og de er regnet av kilden som
 * eide økta.
 *
 * Fila eier det manifestet IKKE har: punktene, pulskurven, høydeprofilen.
 *
 * Ren modul.
 */

/** Én rad i `activities.csv`, oversatt til repoets vokabular. */
export type StravaManifestRow = {
	/** Stravas aktivitets-id. Brukes til å pare rad mot fil, og i rapporten. */
	id: string;
	/** Rå dato-tekst fra eksporten. Norsk format, ikke ISO — se `parseManifestDate`. */
	dateText: string;
	name: string | null;
	/** Kanonisk sportType, mappet fra norsk. `null` når typen er ukjent. */
	sportType: string | null;
	/** Rå aktivitetstype fra eksporten, beholdt så en ukjent verdi kan navngis. */
	rawType: string;
	distanceMeters: number | null;
	elapsedSeconds: number | null;
	movingSeconds: number | null;
	/** Relativ sti i zipen, f.eks. `activities/12345.gpx.gz`. `null` = manuell økt. */
	filePath: string | null;
};

/**
 * Strava eksporterer aktivitetstypen på brukerens SPRÅK, ikke som en api-verdi.
 *
 * En ukjent type gir `null` framfor en gjetning: da faller økta ut av importen
 * med et navn i rapporten, i stedet for å bli en løpetur. Samme skille som
 * `startWorkout.type` i Gemini-profilene — «ikke oppgitt» tåler en default,
 * «oppgitt, men ukjent» skal avvises, fordi en stille default som gjetter en
 * KONKRET verdi er verre enn et avslag.
 */
export const SPORT_TYPE_BY_NORWEGIAN: Record<string, string> = {
	'Løpetur': 'running',
	'Virtuelt løp': 'running',
	'Terrengløp': 'trail_running',
	'Sykkeltur': 'cycling',
	'Virtuell sykkeltur': 'cycling',
	'El-sykkeltur': 'e_bike',
	'Gåtur': 'walking',
	'Fottur': 'hiking',
	'Langrenn': 'skiing',
	'Alpint': 'skiing',
	'Frikjøring': 'skiing',
	'Svømming': 'swimming',
	'Treningsøkt': 'strength',
	'Yoga': 'yoga'
};

export function sportTypeFromNorwegian(rawType: string): string | null {
	return SPORT_TYPE_BY_NORWEGIAN[rawType.trim()] ?? null;
}

/**
 * Minimal CSV-parser: Strava siterer felt med komma og doble anførselstegn.
 *
 * Ligger her framfor i skriptet fordi begge trenger den, og to parsere over
 * samme fil blir to ulike svar på hvor en rad slutter.
 */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;

	for (let i = 0; i < text.length; i += 1) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 1;
				} else quoted = false;
			} else field += c;
			continue;
		}
		if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
		} else if (c !== '\r') field += c;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

/**
 * Kolonnene slås opp på INDEKS, og «Totaltid»/«Distanse» tas fra SISTE
 * forekomst.
 *
 * **Overskriftene er ikke unike.** Begge står to ganger i eksporten: først som
 * en visningsstreng (minutter, km), så som råverdien (sekunder, meter). Et
 * oppslag på navn gir én av dem, og hvilken avhenger av parseren — «45» lest
 * som meter ser ut som et GPS-fragment, og «12,5» lest som sekunder ser ut som
 * en økt på tolv sekunder. Begge feilene er stumme.
 */
const COLUMNS = {
	id: { name: 'Aktivitets-ID', last: false },
	date: { name: 'Aktivitetsdato', last: false },
	name: { name: 'Aktivitetsnavn', last: false },
	type: { name: 'Aktivitetstype', last: false },
	file: { name: 'Filnavn', last: false },
	elapsed: { name: 'Totaltid', last: true },
	moving: { name: 'Bevegelsestid', last: true },
	distance: { name: 'Distanse', last: true }
} as const;

export type ManifestColumnIndex = Record<keyof typeof COLUMNS, number>;

export class StravaManifestError extends Error {}

export function resolveColumns(header: string[]): ManifestColumnIndex {
	const index = {} as ManifestColumnIndex;
	for (const [key, spec] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, { name: string; last: boolean }][]) {
		const at = spec.last ? header.lastIndexOf(spec.name) : header.indexOf(spec.name);
		if (at < 0) {
			throw new StravaManifestError(
				`Fant ikke kolonnen «${spec.name}» i activities.csv. Er dette en Strava-eksport?`
			);
		}
		index[key] = at;
	}
	return index;
}

function toNumber(value: string | undefined): number | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (trimmed === '') return null;
	// Eksporten bruker punktum i råkolonnene, men komma har vært observert i
	// visningskolonnene — vi leser råkolonnene, og tar høyde for begge uansett.
	const n = Number(trimmed.replace(',', '.'));
	return Number.isFinite(n) ? n : null;
}

/** Filnavnet uten `.gz`, så endelsen kan velge parser. */
export function stripGzip(path: string): { path: string; gzipped: boolean } {
	return path.toLowerCase().endsWith('.gz')
		? { path: path.slice(0, -3), gzipped: true }
		: { path, gzipped: false };
}

export function parseStravaManifest(csvText: string): StravaManifestRow[] {
	const rows = parseCsvRows(csvText.replace(/^﻿/, ''));
	if (rows.length === 0) throw new StravaManifestError('activities.csv er tom.');

	const index = resolveColumns(rows[0]);
	const out: StravaManifestRow[] = [];

	for (const row of rows.slice(1)) {
		// En rad kortere enn den bredeste kolonnen vi trenger er avkortet, ikke tom.
		if (row.length <= index.distance) continue;
		const id = row[index.id]?.trim();
		if (!id) continue;

		const rawType = row[index.type]?.trim() ?? '';
		const file = row[index.file]?.trim() ?? '';

		out.push({
			id,
			dateText: row[index.date]?.trim() ?? '',
			name: row[index.name]?.trim() || null,
			sportType: sportTypeFromNorwegian(rawType),
			rawType,
			distanceMeters: toNumber(row[index.distance]),
			elapsedSeconds: toNumber(row[index.elapsed]),
			movingSeconds: toNumber(row[index.moving]),
			filePath: file || null
		});
	}

	return out;
}

/**
 * Hvorfor en rad ikke kan importeres. `null` = klar.
 *
 * Rekkefølgen er den rapporten skal lese i: en rad uten fil er en manuell økt
 * (forventet, 100 av dem i arkivet), en ukjent sport er noe vi må utvide kartet
 * for, og en manglende starttid er en ødelagt rad.
 */
export type SkipReason = 'ingen-fil' | 'ukjent-sport' | 'ingen-starttid';

export function skipReasonFor(row: StravaManifestRow): SkipReason | null {
	if (!row.filePath) return 'ingen-fil';
	if (!row.sportType) return 'ukjent-sport';
	return null;
}

/**
 * Manifestets tall som en `TriageCandidate`.
 *
 * Triagen kjøres på MANIFESTET, altså før én fil er pakket ut — det er hele
 * poenget med å ha den: en sykkeltur merket «Run» skal ikke skrives og siden
 * ryddes opp, for i mellomtiden har den vært en distanserekord.
 */
export function triageCandidateFromRow(row: StravaManifestRow) {
	return {
		id: row.id,
		date: row.dateText,
		name: row.name,
		sportType: row.sportType,
		distanceMeters: row.distanceMeters,
		elapsedSeconds: row.elapsedSeconds,
		movingSeconds: row.movingSeconds
	};
}
