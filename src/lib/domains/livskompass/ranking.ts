/**
 * Rekkefølgen — brukerens egen prioritering, ordnet.
 *
 * ## Hvorfor dette må finnes
 *
 * Brukerens egne ord: det manglet «en mulighet til å prioritere f.eks helse
 * først, deretter bidrag hjemme, deretter ekstra oppmerksomhet til hvert
 * enkelt av barna fra ti års alder».
 *
 * Retningen hadde prosa (visjonene), verdier (uordnede), et ukentlig hjul
 * (tolv uavhengige akser) og fra september 2026 bevisste nedprioriteringer.
 * Ingen av dem sier hva som kommer FØRST. Uten en rekkefølge har en coach
 * ingenting å avgjøre med når to ting ikke får plass i samme uke, og svaret
 * blir at begge er viktige — som er sant og ubrukelig.
 *
 * ## Rekkefølgen og nedprioriteringene er ikke hverandres motsatser
 *
 * Fristelsen er å utlede: det som ikke står på lista, er nedprioritert. Det er
 * feil begge veier. En nedprioritering er et DATERT valg med en termin og et
 * oppgjør (`deprioritization.ts`); at kultur ikke står blant tre prioriteringer
 * betyr bare at tre ting kom foran. Utled aldri den ene av den andre — da
 * forsvinner nettopp skillet mellom valg og drift som den modulen finnes for.
 *
 * ## Rangen er POSISJONEN, aldri et lagret tall
 *
 * Et `rank`-felt ved siden av en array er to kilder til samme faktum, og de
 * kan bli uenige (to toere, et hopp fra 1 til 3). Rekkefølgen i lista ER
 * rangen.
 *
 * DB-fri. Se `docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md`.
 */

import { LIVSKOMPASS_AREAS, LIVSKOMPASS_DIMENSIONS } from './dimensions';

/**
 * Tak på antall prioriteringer.
 *
 * Tolv rangerte ting er ikke en rangering — det er livshjulet om igjen, bare
 * på en linje. Brukerens eget eksempel hadde tre. Fem er romslig nok til at et
 * intervju kan foreslå og brukeren stryke.
 */
export const MAX_PRIORITIES = 5;

/** Etiketten skal kunne leses i én linje i en prompt og på en flate. */
export const MAX_LABEL_CHARS = 80;

/** Begrunnelsen er en setning, ikke et avsnitt — prosaen bor i visjonene. */
export const MAX_WHY_CHARS = 300;

/**
 * Når rekkefølgen begynner å si om seg selv at den er gammel.
 *
 * Et år, som intervjuet den settes i. Den slettes ikke og slutter ikke å
 * gjelde — men en prioritering fra forrige livsfase skal ikke brukes til å
 * avgjøre noe uten at noen har sagt at den fortsatt stemmer. Samme grep som
 * forfallet på milepælene: bakgrunn framfor fjerning.
 */
export const RANKING_STALE_DAYS = 365;

/** Hva prioriteringen peker på i livskompasset, når den peker på noe. */
export type PriorityAnchorKind = 'dimension' | 'area';

export interface Priority {
	/** Brukerens egne ord. Rangen er posisjonen i lista. */
	label: string;
	/** Dimensjon eller område den er forankret i, eller null. */
	anchorKind: PriorityAnchorKind | null;
	anchorId: string | null;
	/** Hvorfor den står der den står. Valgfri. */
	why: string | null;
}

export interface Ranking {
	priorities: Priority[];
	/** Dagen rekkefølgen sist ble satt, 'YYYY-MM-DD'. */
	setOn: string;
}

export interface PriorityAnchor {
	kind: PriorityAnchorKind;
	id: string;
	label: string;
}

function norm(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * Finn forankringen i livskompasset — eller ingen.
 *
 * To ting gjør dette annerledes enn et vanlig oppslag:
 *
 * 1. **Områder teller like mye som dimensjoner.** «Helse først» peker på et
 *    OMRÅDE; det finnes ingen `helse`-dimensjon, bare søvn, trening og mat.
 *    Bare dimensjoner ville gjort brukerens eget eksempel uforankret.
 * 2. **Vi gjetter ALDRI.** Treffet er eksakt på id, full etikett eller kort
 *    etikett. «Mer tid til barna» forankres ikke i «Barn» ved delstreng —
 *    samme regel som at `inferGoalKind` heller returnerer null enn å gjette
 *    en konkret verdi. En uforankret prioritering er fullt gyldig; en
 *    feilforankret er en stille løgn om hva hjulet måler.
 */
export function resolvePriorityAnchor(label: string): PriorityAnchor | null {
	const key = norm(label);
	if (!key) return null;
	for (const dim of LIVSKOMPASS_DIMENSIONS) {
		if (key === dim.id || key === norm(dim.label) || key === norm(dim.short)) {
			return { kind: 'dimension', id: dim.id, label: dim.label };
		}
	}
	for (const area of LIVSKOMPASS_AREAS) {
		if (key === area.id || key === norm(area.label)) {
			return { kind: 'area', id: area.id, label: area.label };
		}
	}
	return null;
}

/* ── Validering ──────────────────────────────────────────────────────────── */

export interface PriorityInput {
	label?: unknown;
	why?: unknown;
}

export type RankingValidation =
	| { ok: true; value: Priority[] }
	| { ok: false; error: string };

/**
 * Normaliser og valider en liste prioriteringer fra en klient eller et
 * intervju.
 *
 * Forankringen utledes her og lagres ikke som klientens påstand: den er en
 * funksjon av etiketten, og to kilder til samme faktum blir uenige.
 */
export function validatePriorities(input: unknown): RankingValidation {
	if (!Array.isArray(input)) {
		return { ok: false, error: 'Prioriteringene må være en liste.' };
	}
	if (input.length > MAX_PRIORITIES) {
		return {
			ok: false,
			error: `Maks ${MAX_PRIORITIES} prioriteringer — en lengre liste er ingen rekkefølge.`
		};
	}
	const value: Priority[] = [];
	const seen = new Set<string>();
	for (const raw of input as PriorityInput[]) {
		const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
		if (!label) return { ok: false, error: 'En prioritering må ha en tekst.' };
		if (label.length > MAX_LABEL_CHARS) {
			return { ok: false, error: `«${label.slice(0, 30)}…» er lengre enn ${MAX_LABEL_CHARS} tegn.` };
		}
		if (seen.has(norm(label))) {
			return { ok: false, error: `«${label}» står to ganger — en rekkefølge har én plass per ting.` };
		}
		seen.add(norm(label));
		const why = typeof raw?.why === 'string' ? raw.why.trim() : '';
		if (why.length > MAX_WHY_CHARS) {
			return { ok: false, error: `Begrunnelsen for «${label}» er lengre enn ${MAX_WHY_CHARS} tegn.` };
		}
		const anchor = resolvePriorityAnchor(label);
		value.push({
			label,
			anchorKind: anchor?.kind ?? null,
			anchorId: anchor?.id ?? null,
			why: why || null
		});
	}
	return { ok: true, value };
}

/**
 * Les en LAGRET liste.
 *
 * Strengt ved skriving, tolerant ved lesing — og det er ikke slurv, det er
 * hvem som blir straffet av en avvisning. `validatePriorities` er en regel om
 * hva som kan SETTES; en lagret rekkefølge er noe brukeren alt har satt, og en
 * senere innstramming av taket skal ikke få den til å forsvinne uten et ord.
 *
 * Forankringen regnes på nytt her, siden en dimensjon kan ha byttet navn eller
 * blitt fjernet — da mister punktet forankringen framfor å peke på ingenting.
 */
export function normalizeStoredPriorities(input: unknown): Priority[] {
	if (!Array.isArray(input)) return [];
	const out: Priority[] = [];
	for (const raw of input as PriorityInput[]) {
		const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
		if (!label) continue;
		const why = typeof raw?.why === 'string' ? raw.why.trim() : '';
		const anchor = resolvePriorityAnchor(label);
		out.push({
			label,
			anchorKind: anchor?.kind ?? null,
			anchorId: anchor?.id ?? null,
			why: why || null
		});
	}
	return out;
}

/* ── Alder ───────────────────────────────────────────────────────────────── */

function isDayKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayDiff(fromKey: string, toKey: string): number {
	const [fy, fm, fd] = fromKey.split('-').map(Number);
	const [ty, tm, td] = toKey.split('-').map(Number);
	return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Dager siden rekkefølgen ble satt, eller null om datoen ikke er lesbar. */
export function rankingAgeDays(ranking: Ranking, todayKey: string): number | null {
	if (!isDayKey(ranking.setOn)) return null;
	return dayDiff(ranking.setOn, todayKey);
}

export function isRankingStale(ranking: Ranking, todayKey: string): boolean {
	const age = rankingAgeDays(ranking, todayKey);
	return age !== null && age > RANKING_STALE_DAYS;
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

const MONTHS = [
	'januar', 'februar', 'mars', 'april', 'mai', 'juni',
	'juli', 'august', 'september', 'oktober', 'november', 'desember'
];

function longDate(dayKey: string): string {
	const [y, m, d] = dayKey.split('-');
	return `${Number(d)}. ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Én linje per prioritering, rangen som posisjon. */
export function describeRanking(ranking: Ranking): string {
	return ranking.priorities
		.map((p, i) => `${i + 1}. ${p.label}${p.why ? ` — ${p.why}` : ''}`)
		.join('\n');
}

/**
 * Rekkefølge-seksjonen i chat-konteksten.
 *
 * Instruksen under lista er det som gjør rekkefølgen til noe annet enn en
 * liste: uten den leser modellen tre prioriteringer som tre ting som er
 * viktige, og da er vi tilbake til at begge sider har et poeng. Rekkefølgen
 * finnes for øyeblikket der noe må vike.
 */
export function buildRankingBlock(ranking: Ranking | null, todayKey: string): string {
	if (!ranking || ranking.priorities.length === 0) return '';

	const stale = isRankingStale(ranking, todayKey);
	// En rad uten lesbar dato skal ikke bli «satt NaN. undefined» — da sier vi
	// heller ingenting om når den ble satt.
	const satt = isDayKey(ranking.setOn) ? `, satt ${longDate(ranking.setOn)}` : '';
	let out = `\nREKKEFØLGEN (brukerens egen prioritering${satt}):\n`;
	out += describeRanking(ranking) + '\n';
	out +=
		'\nBruk rekkefølgen når to ting ikke får plass i samme uke: si hva som skal vike, ikke at ' +
		'begge er viktige. Den sier ingenting om hva som er nedprioritert — det som ikke står her ' +
		'er ikke valgt bort, det er bare ikke først.\n';
	if (stale) {
		out +=
			'Rekkefølgen er over et år gammel. Bruk den, men spør én gang om den fortsatt stemmer ' +
			'før du lar den avgjøre noe stort.\n';
	}
	return out;
}
