/**
 * Ren validerings- og klassifiseringslogikk for mål. Skilt ut fra
 * server-koden så den kan enhetstestes uten DB.
 */

/** Meta-ord som aldri skal være mål-titler — mål skal være konkrete livsmål. */
const META_TITLE_WORDS = [
	'planlegging',
	'planlegge',
	'struktur',
	'rutine',
	'rutiner',
	'organisering',
	'organisere',
	'generelt',
	'diverse',
	'annet',
	'oppfølging',
	'vaner'
];

/**
 * Er dette en meta-tittel («Planlegging», «Bedre struktur», «Rutiner»)?
 * Matcher når tittelen i praksis bare består av meta-ord + fyllord —
 * «Planlegge bryllupet» er et ekte mål, «Planlegging» er det ikke.
 */
export function isMetaGoalTitle(title: string): boolean {
	const normalized = title
		.toLowerCase()
		.replace(/[^a-zæøåäöü\s]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	if (normalized.length === 0) return true;

	const FILLER = new Set(['bedre', 'mer', 'mindre', 'god', 'gode', 'min', 'mine', 'i', 'på', 'av', 'og', 'hverdagen', 'uka', 'uken']);
	const meaningful = normalized.filter((w) => !FILLER.has(w));
	if (meaningful.length === 0) return true;

	return meaningful.every((w) => META_TITLE_WORDS.includes(w));
}

export type GoalHorizon = 'kort' | 'lang';

/** Dager som skiller «Neste tre måneder» fra «På lang sikt». */
export const HORIZON_THRESHOLD_DAYS = 100;

/**
 * Tidshorisont for et mål: frist innen ~3 måneder (eller ingen frist) → kort,
 * ellers lang. Ingen frist regnes som «pågående nå» og hører til kort sikt.
 */
export function goalHorizon(
	targetDate: string | Date | null | undefined,
	now = new Date()
): GoalHorizon {
	if (!targetDate) return 'kort';
	const target = new Date(targetDate).getTime();
	if (!Number.isFinite(target)) return 'kort';
	const days = (target - now.getTime()) / 86_400_000;
	return days <= HORIZON_THRESHOLD_DAYS ? 'kort' : 'lang';
}

/** Har fristen passert? Ugyldig/manglende frist regnes som ikke utløpt. */
export function isGoalExpired(
	targetDate: string | Date | null | undefined,
	now = new Date()
): boolean {
	if (!targetDate) return false;
	const target = new Date(targetDate).getTime();
	if (!Number.isFinite(target)) return false;
	return target < now.getTime();
}

/**
 * Er et vektmål nådd? Nådd = krysset målverdien i målets retning
 * (nedgangsmål: current ≤ target, oppgangsmål: current ≥ target).
 */
export function isWeightGoalReached(
	startWeight: number,
	currentWeight: number,
	targetWeight: number
): boolean {
	if (targetWeight < startWeight) return currentWeight <= targetWeight;
	if (targetWeight > startWeight) return currentWeight >= targetWeight;
	return currentWeight === targetWeight;
}

/** Er et akkumulert løpemål nådd? */
export function isRunningGoalReached(currentKm: number, targetKm: number): boolean {
	return targetKm > 0 && currentKm >= targetKm;
}
