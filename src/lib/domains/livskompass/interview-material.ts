/**
 * Livskompasset som MATERIALE til livsintervjuet.
 *
 * ## Hvorfor
 *
 * Intervjuet fikk fram til september 2026 livskompasset som en statisk
 * ordliste — tolv etiketter gruppert per område, brukt som «døråpnere hvis
 * samtalen trenger terreng». Brukerens egne målinger var ikke med i det hele
 * tatt. Det er hele klagen: intervjuet «er ikke koblet mot livskompasset».
 *
 * Forskjellen er ikke kosmetisk. En liste med ord kan modellen finne på selv.
 * «Venner har ligget ute av synk i sju av åtte uker» kan den ikke — og det er
 * nøyaktig den typen observasjon et tiårsspørsmål skal møtes med.
 *
 * ## Én uke er ikke et mønster
 *
 * Et gap i én uke er en dårlig uke. Det som hører hjemme i en samtale om ti år,
 * er det som har vært sant uke etter uke. Derfor telles VEDVARENHET
 * (`weeksOutOfSync` av `weeks`), og under `MIN_WEEKS_FOR_PATTERN` sies tallene
 * uten dom — samme regel som `describeWeeklyIntensity`.
 *
 * ## Median, ikke snitt
 *
 * Én ekstremuke skal ikke flytte bildet, som ellers i dette repoet.
 *
 * ## Et VALGT gap er også materiale — men et annet spørsmål
 *
 * Coachingen i `dimensions.ts` filtrerer bevisste nedprioriteringer HELT ut:
 * uka skal ikke be deg heve det du nettopp bestemte deg for å legge bort.
 * Intervjuet er motsatt. Det handler om årene, og da er terminen selv
 * spørsmålet — «du la kultur bort ut november; er det tredje gang på rad?».
 * Derfor listes de for seg, med den innrammingen.
 *
 * ## Materialet SIER hva det måler, aldri hva det betyr
 *
 * Tolkningen er intervjuets jobb. Skriver vi dommen inn her, gjentar modellen
 * den som sin egen innsikt — og da har vi laget en trakt til.
 *
 * DB-fri. Se `docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md`.
 */

import {
	LIVSKOMPASS_AREAS,
	LIVSKOMPASS_DIMENSIONS,
	NEUTRAL_MATCH,
	OUT_OF_SYNC_MIN_GAP,
	OUT_OF_SYNC_MIN_IMPORTANCE,
	type LivskompassScores
} from './dimensions';
import {
	activeForDimension,
	describeDeprioritization,
	type ResolvedDeprioritization
} from './deprioritization';

/** Antall uker som må være målt før et mønster kan påstås. */
export const MIN_WEEKS_FOR_PATTERN = 4;

/** Antall uker som må være målt før en retning kan leses av halvdelene. */
export const MIN_WEEKS_FOR_TREND = 6;

/** Hvor mye medianen må ha flyttet seg mellom halvdelene for å telle. */
export const TREND_MIN_SHIFT = 1;

/** Andel av de målte ukene en dimensjon må ligge ute av synk for å være vedvarende. */
export const PERSISTENT_SHARE = 0.5;

/** Hvor mange linjer materialet leverer per bolk. En prompt er ikke en rapport. */
export const MAX_MATERIAL_LINES = 5;

export interface InterviewWeek {
	week: string;
	scores: LivskompassScores;
}

export type PatternTrend = 'bedre' | 'verre' | 'flatt';

export interface DimensionPattern {
	dimensionId: string;
	label: string;
	areaLabel: string;
	/** Median viktighet over de målte ukene. */
	importance: number;
	/** Median samsvar over de målte ukene. */
	medianMatch: number;
	/** Antall uker dimensjonen lå ute av synk. */
	weeksOutOfSync: number;
	/** Antall uker den er målt i. */
	weeks: number;
	/** Ute av synk i minst halvparten av ukene, og nok uker til å påstå det. */
	persistent: boolean;
	/** Retning mellom eldste og nyeste halvdel, eller null om for få uker. */
	trend: PatternTrend | null;
	/** Dekket av en aktiv, bevisst nedprioritering. */
	chosen: boolean;
	/** Setningen om nedprioriteringen, når den finnes. */
	chosenSentence: string | null;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

const areaLabelById = new Map(LIVSKOMPASS_AREAS.map((a) => [a.id, a.label]));

/**
 * Regn mønstre per dimensjon over de målte ukene.
 *
 * Ukene forventes nyest først (slik `getLivskompassRecent` leverer dem); bare
 * uker der dimensjonen faktisk er scoret teller i nevneren, så en dimensjon som
 * kom til senere ikke ser ut til å ha vært på plass hele tiden.
 */
export function buildInterviewPatterns(
	weeks: InterviewWeek[],
	deprioritizations: ResolvedDeprioritization[] = []
): DimensionPattern[] {
	return LIVSKOMPASS_DIMENSIONS.map((dim) => {
		const scored = weeks
			.map((w) => w.scores?.[dim.id])
			.filter((s): s is { importance: number; match: number } => Boolean(s));

		const importances = scored.map((s) => s.importance);
		const matches = scored.map((s) => s.match);
		const outOfSync = scored.filter(
			(s) => s.importance - s.match >= OUT_OF_SYNC_MIN_GAP && s.importance >= OUT_OF_SYNC_MIN_IMPORTANCE
		).length;

		// Retningen leses av halvdelene. Ukene er nyest først, så den NYESTE
		// halvdelen er starten på lista — en forveksling her ville snudd hver
		// eneste dom, og den er stum.
		let trend: PatternTrend | null = null;
		if (scored.length >= MIN_WEEKS_FOR_TREND) {
			const half = Math.floor(scored.length / 2);
			const shift = median(matches.slice(0, half)) - median(matches.slice(scored.length - half));
			trend = Math.abs(shift) < TREND_MIN_SHIFT ? 'flatt' : shift > 0 ? 'bedre' : 'verre';
		}

		const period = activeForDimension(deprioritizations, dim.id);

		return {
			dimensionId: dim.id,
			label: dim.label,
			areaLabel: areaLabelById.get(dim.area) ?? dim.area,
			importance: round1(importances.length ? median(importances) : dim.defaultImportance),
			medianMatch: round1(matches.length ? median(matches) : NEUTRAL_MATCH),
			weeksOutOfSync: outOfSync,
			weeks: scored.length,
			persistent:
				scored.length >= MIN_WEEKS_FOR_PATTERN && outOfSync >= scored.length * PERSISTENT_SHARE,
			trend,
			chosen: Boolean(period),
			chosenSentence: period ? describeDeprioritization(period) : null
		};
	});
}

function patternLine(p: DimensionPattern): string {
	const trend = p.trend ? ` Retning: ${p.trend}.` : '';
	return (
		`- ${p.label} (${p.areaLabel}): viktighet ${p.importance}/10, samsvar ${p.medianMatch}/10 i median, ` +
		`ute av synk ${p.weeksOutOfSync} av ${p.weeks} uker.${trend}`
	);
}

export interface InterviewMaterialInput {
	weeks: InterviewWeek[];
	deprioritizations?: ResolvedDeprioritization[];
	/** Viktighetsprofilen fra onboarding — eneste kilde når ingen uker er målt. */
	importance?: Record<string, number> | null;
}

/**
 * Materialet som går inn i intervjupromptene.
 *
 * Tom streng når det ikke finnes noe å si — en overskrift uten innhold leses
 * som at data mangler, og en modell som ser mange «ukjent» begynner å gjette.
 */
export function describeLivskompassMaterial(input: InterviewMaterialInput): string {
	const weeks = input.weeks ?? [];
	const patterns = buildInterviewPatterns(weeks, input.deprioritizations ?? []);
	const measured = Math.max(...patterns.map((p) => p.weeks), 0);

	if (measured === 0) {
		const importance = input.importance ?? null;
		if (!importance) return '';
		const top = LIVSKOMPASS_DIMENSIONS.map((d) => ({ label: d.label, value: importance[d.id] }))
			.filter((d): d is { label: string; value: number } => typeof d.value === 'number')
			.sort((a, b) => b.value - a.value)
			.slice(0, MAX_MATERIAL_LINES);
		if (top.length === 0) return '';
		return [
			'LIVSKOMPASSET (brukerens egen vekting, men ingen ukesinnsjekker ennå):',
			top.map((d) => `- ${d.label}: ${d.value}/10`).join('\n'),
			'',
			'Dette er hva brukeren har SAGT betyr mest. Ingen målinger av hvordan hverdagen faktisk ' +
				'ser ut mot det — så ikke påstå noe om avvik. Spør heller om vektingen fortsatt stemmer.'
		].join('\n');
	}

	const drifting = patterns
		.filter((p) => !p.chosen && p.weeksOutOfSync > 0)
		.sort((a, b) => b.weeksOutOfSync - a.weeksOutOfSync || b.importance - a.importance)
		.slice(0, MAX_MATERIAL_LINES);
	const chosen = patterns.filter((p) => p.chosen);
	const steady = patterns
		.filter((p) => !p.chosen && p.weeksOutOfSync === 0 && p.weeks > 0)
		.sort((a, b) => b.importance - a.importance)
		.slice(0, 3);

	const parts: string[] = [
		`LIVSKOMPASSET, MÅLT (${measured} uker med ukesinnsjekk — tall, ikke brukerens ord):`
	];

	if (drifting.length > 0) {
		parts.push('Størst avstand mellom viktighet og hverdag:');
		parts.push(drifting.map(patternLine).join('\n'));
	}
	if (steady.length > 0) {
		parts.push(
			'Det som faktisk har fått plass: ' +
				steady.map((p) => `${p.label} (${p.medianMatch}/10)`).join(', ') +
				'.'
		);
	}
	if (chosen.length > 0) {
		parts.push('Valgt bort i perioden — dette er et VALG, ikke drift:');
		parts.push(chosen.map((p) => `- ${p.chosenSentence}`).join('\n'));
		parts.push(
			'Ikke be brukeren rette opp disse. Spørsmålet her er et annet: holder valget over år, ' +
				'og er det i ferd med å bli en tilstand framfor en periode?'
		);
	}

	parts.push('');
	if (measured < MIN_WEEKS_FOR_PATTERN) {
		parts.push(
			`Bare ${measured} uker er målt. Si tallene hvis de er relevante, men ikke kall dem et ` +
				'mønster — én dårlig uke ser likedan ut.'
		);
	} else {
		parts.push(
			'Dette er hva som har vært sant uke etter uke. Bruk det som materiale å konfrontere med — ' +
				'tallene sier hva som er MÅLT, ikke hva det BETYR. Spør brukeren hva som ligger bak; ' +
				'ikke konkluder på hans vegne.'
		);
	}

	return parts.join('\n');
}
