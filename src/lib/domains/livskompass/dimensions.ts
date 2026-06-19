/**
 * Livskompasset — ACT-basert verdikompass som ukentlig helgeøvelse.
 *
 * Hver dimensjon scores på to akser: viktighet (forhåndsutfylt, justeres ved
 * behov) og ukens samsvar. Gapet mellom dem — viktig, men lite rom i uka — er
 * det som er «ute av synk», og det chatten tar tak i.
 *
 * Dette er eneste kilde for dimensjoner/farger/terskler. Brukes av prototypen
 * på /design, serverlaget og hjemskjerm-flyten.
 */

export interface LivskompassArea {
	id: string;
	label: string;
	color: string;
}

export const LIVSKOMPASS_AREAS: LivskompassArea[] = [
	{ id: 'relasjoner', label: 'Relasjoner', color: '#e0607e' },
	{ id: 'helse', label: 'Helse', color: '#4b9fe0' },
	{ id: 'arbeid', label: 'Arbeid', color: '#9b78f0' },
	{ id: 'mening', label: 'Fritid & mening', color: '#5fb87a' }
];

export function colorForArea(areaId: string): string {
	return LIVSKOMPASS_AREAS.find((a) => a.id === areaId)?.color ?? '#7c8ef5';
}

export interface LivskompassDimensionDef {
	id: string;
	/** Full etikett i scoring-listen */
	label: string;
	/** Kort etikett i hjulet */
	short: string;
	area: string;
	color: string;
	/** Forhåndsutfylt viktighet (1–5) — startverdi før bruker har scoret noen uker */
	defaultImportance: number;
}

const RAW_DIMENSIONS: Omit<LivskompassDimensionDef, 'color'>[] = [
	{ id: 'partner', label: 'Partner', short: 'Partner', area: 'relasjoner', defaultImportance: 9 },
	{ id: 'barn', label: 'Barn', short: 'Barn', area: 'relasjoner', defaultImportance: 9 },
	{ id: 'venner', label: 'Venner', short: 'Venner', area: 'relasjoner', defaultImportance: 6 },
	{ id: 'sovn', label: 'Søvn & hvile', short: 'Søvn', area: 'helse', defaultImportance: 8 },
	{ id: 'trening', label: 'Trening', short: 'Trening', area: 'helse', defaultImportance: 7 },
	{ id: 'mat', label: 'Mat & kropp', short: 'Mat', area: 'helse', defaultImportance: 6 },
	{ id: 'jobb', label: 'Jobb', short: 'Jobb', area: 'arbeid', defaultImportance: 7 },
	{ id: 'laering', label: 'Læring & utvikling', short: 'Læring', area: 'arbeid', defaultImportance: 6 },
	{ id: 'hobbyer', label: 'Hobbyer', short: 'Hobbyer', area: 'mening', defaultImportance: 5 },
	{ id: 'egentid', label: 'Egen tid', short: 'Egen tid', area: 'mening', defaultImportance: 7 },
	{ id: 'natur', label: 'Natur', short: 'Natur', area: 'mening', defaultImportance: 7 },
	{ id: 'kultur', label: 'Kultur', short: 'Kultur', area: 'mening', defaultImportance: 5 }
];

export const LIVSKOMPASS_DIMENSIONS: LivskompassDimensionDef[] = RAW_DIMENSIONS.map((d) => ({
	...d,
	color: colorForArea(d.area)
}));

export const LIVSKOMPASS_DIMENSION_IDS = LIVSKOMPASS_DIMENSIONS.map((d) => d.id);

export function dimensionById(id: string): LivskompassDimensionDef | undefined {
	return LIVSKOMPASS_DIMENSIONS.find((d) => d.id === id);
}

// Begge akser rangeres 1–10: viktighet (onboarding-skala) og ukens samsvar.
export const IMPORTANCE_MAX = 10;
export const MATCH_MAX = 10;
/** Nøytral startverdi for samsvar-slideren (midt på 1–10). */
export const NEUTRAL_MATCH = 5;

/** Grovt ord for et samsvar på 1–10 (anker, ikke én etikett per trinn). */
export function matchLabel(v: number): string {
	if (v <= 2) return 'Langt unna';
	if (v <= 4) return 'Litt unna';
	if (v <= 6) return 'Sånn passe';
	if (v <= 8) return 'Ganske på linje';
	return 'Helt på linje';
}

/** Grovt ord for en viktighet på 1–10 (anker, ikke én etikett per trinn). */
export function importanceLabel(v: number): string {
	if (v <= 2) return 'Lite viktig';
	if (v <= 4) return 'Litt viktig';
	if (v <= 6) return 'Ganske viktig';
	if (v <= 8) return 'Viktig';
	return 'Avgjørende';
}

/** Score for én dimensjon: viktighet (1–10) + ukens samsvar (1–10). */
export interface DimensionScore {
	importance: number;
	match: number;
}

/** Alle dimensjoner for én uke, keyet på dimensjons-id. */
export type LivskompassScores = Record<string, DimensionScore>;

// ── «Ute av synk»-terskler ────────────────────────────────────────────────
// Gapet er signalet, ikke samsvaret alene. Begge akser er nå 1–10, så gapet er
// rett differanse: ute av synk = viktig nok (≥6) og samsvaret ligger merkbart under (gap ≥3).
export const OUT_OF_SYNC_MIN_GAP = 3;
export const OUT_OF_SYNC_MIN_IMPORTANCE = 6;

export interface OutOfSyncItem extends LivskompassDimensionDef {
	importance: number;
	match: number;
	/** Gap (1–10-poeng): viktighet − samsvar. */
	gap: number;
}

/** Dimensjoner ute av synk, sortert på størst gap. */
export function computeOutOfSync(scores: LivskompassScores): OutOfSyncItem[] {
	return LIVSKOMPASS_DIMENSIONS.map((d) => {
		const score = scores[d.id];
		const importance = score?.importance ?? d.defaultImportance;
		const match = score?.match ?? NEUTRAL_MATCH;
		const gap = importance - match;
		return { ...d, importance, match, gap };
	})
		.filter((d) => d.gap >= OUT_OF_SYNC_MIN_GAP && d.importance >= OUT_OF_SYNC_MIN_IMPORTANCE)
		.sort((a, b) => b.gap - a.gap || b.importance - a.importance);
}

/** Snitt-samsvar over alle dimensjoner, til senteret i hjulet. */
export function averageMatch(scores: LivskompassScores): number {
	const vals = LIVSKOMPASS_DIMENSIONS.map((d) => scores[d.id]?.match ?? NEUTRAL_MATCH);
	if (!vals.length) return 0;
	return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/**
 * Åpningsmelding til chatten, seedet fra de største gapene. Holdt her så
 * prototype og produksjon formulerer det likt.
 */
export function buildChatSeed(outOfSync: OutOfSyncItem[]): string {
	if (!outOfSync.length) {
		return 'Uka føltes ganske på linje med det som betyr noe. Vil du se nærmere på noe likevel?';
	}
	const top = outOfSync[0];
	const second = outOfSync[1];
	let msg = `«${top.label}» betyr mye for deg (${top.importance}/10), men uka som gikk ga det lite rom (${top.match}/10).`;
	if (second) {
		msg += ` Det samme gjelder «${second.label.toLowerCase()}».`;
	}
	msg += ' Hva var det som tok plassen — og hva skulle til for at neste uke kjentes mer på linje?';
	return msg;
}

// ── ACT-coaching: mål om å heve ett poeng ──────────────────────────────────
// Psykologens modell: sett et lite mål om å forbedre ett eller flere av de
// største avvikene med ett poeng neste uke. Chatten coacher mot konkrete grep.

/** Hvor mange av de største avvikene coachingen fokuserer på. */
export const COACHING_TOP_GAPS = 3;

/**
 * System-prompt-prefiks som gjør hjem-chatten til en ACT-coach for ukens kompass.
 * Sendes som prefiks på toppen av den vanlige modulære prompten (server: systemPromptPrefix).
 */
export function buildCoachingSystemPrompt(scores: LivskompassScores): string {
	const oos = computeOutOfSync(scores).slice(0, COACHING_TOP_GAPS);
	const gapLines = oos.length
		? oos
				.map((d, i) => `${i + 1}. «${d.label}» — viktighet ${d.importance}/10, samsvar ${d.match}/10 (gap ${d.gap})`)
				.join('\n')
		: '(ingen store avvik denne uka)';
	return [
		'Du er en varm, konkret ACT-coach (Acceptance and Commitment Therapy).',
		'Brukeren har nettopp fylt ut Livskompasset — en ukentlig verdi-innsjekk der hvert livsområde scores på to akser: hvor viktig det er (1–10) og hvor godt uka som gikk samsvarte med det (1–10). Gapet mellom dem er det som er «ute av synk».',
		'',
		'OMRÅDER MED STØRST GAP DENNE UKA:',
		gapLines,
		'',
		'DIN ROLLE:',
		'- Hjelp brukeren sette ett lite, konkret mål: å heve ETT poeng (f.eks. fra 3 til 4) neste uke for ett eller to av de største avvikene.',
		'- Utforsk kort hva som tok plassen, og foreslå konkrete, små grep som faktisk lar seg gjøre i en vanlig uke.',
		'- Hold det varmt og kort — én ting om gangen, ikke lange lister.',
		'- Det handler om verdier og retning, ikke prestasjon eller moralisering.',
		'- Avslutt med ett tydelig neste-steg brukeren kan ta denne uka.',
		'- Når dere blir enige om konkrete, målbare tiltak og brukeren vil føre dem opp: bruk verktøyet `add_to_week_plan` med weekOffset=1 (neste uke). Skriv frekvens rett i teksten, f.eks. «Skjermfri 16–19 tre kvelder» eller «Legge meg før kl. 21 en gang».'
	].join('\n');
}

/** Førsteperson-åpningsmelding som inviterer coachingen mot ett-poengs-målet. */
export function buildCoachingSeed(scores: LivskompassScores, note?: string | null): string {
	const oos = computeOutOfSync(scores);
	const cleanNote = note?.trim();
	if (!oos.length) {
		const base = 'Jeg fylte ut ukens livskompass, og det meste føltes på linje. Er det likevel noe verdt å styrke litt neste uke?';
		return cleanNote ? `${base} ${cleanNote}` : base;
	}
	const top = oos[0];
	const second = oos[1];
	let msg = `Jeg fylte ut ukens livskompass. Det som er mest ute av synk er ${top.label.toLowerCase()}`;
	if (second) msg += ` og ${second.label.toLowerCase()}`;
	msg += '. Jeg vil gjerne klare å heve ett poeng på ett av dem neste uke — kan du hjelpe meg finne ett konkret grep?';
	if (cleanNote) msg += ` ${cleanNote}`;
	return msg;
}

// ── Uke-nøkkel + helg-gate ──────────────────────────────────────────────────

/**
 * Lokal ISO-uke (f.eks. «2026-W24») — kompasset følger brukerens kalenderuke.
 * Samme algoritme som hjemskjermens checklist-kontekster.
 */
export function localIsoWeek(now: Date = new Date()): string {
	const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const year = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(year, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${year}-W${String(weekNo).padStart(2, '0')}`;
}

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;
export function isValidWeekKey(value: unknown): value is string {
	return typeof value === 'string' && WEEK_KEY_RE.test(value);
}

/** localStorage-nøkkel som markerer at ukas kompass er registrert eller dismisset. */
export function livskompassWeekStorageKey(week: string): string {
	return `livskompass-week-${week}`;
}

/** Bygger en full score-map med forhåndsutfylt viktighet og nøytralt samsvar (3). */
export function defaultScores(prefillImportance?: Record<string, number> | null): LivskompassScores {
	const scores: LivskompassScores = {};
	for (const d of LIVSKOMPASS_DIMENSIONS) {
		scores[d.id] = {
			importance: prefillImportance?.[d.id] ?? d.defaultImportance,
			match: NEUTRAL_MATCH
		};
	}
	return scores;
}

/** Startverdier for onboarding-rangeringen (viktighet 1–10), prefylt fra defaults. */
export function defaultImportanceMap(): Record<string, number> {
	const map: Record<string, number> = {};
	for (const d of LIVSKOMPASS_DIMENSIONS) map[d.id] = d.defaultImportance;
	return map;
}

/** Validerer at en viktighets-map har gyldige 1–10-heltall for alle dimensjoner. */
export function isValidImportanceMap(value: unknown): value is Record<string, number> {
	if (!value || typeof value !== 'object') return false;
	const map = value as Record<string, unknown>;
	return LIVSKOMPASS_DIMENSIONS.every((d) => {
		const v = map[d.id];
		return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= IMPORTANCE_MAX;
	});
}
