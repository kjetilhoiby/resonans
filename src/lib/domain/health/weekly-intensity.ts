/**
 * Ukas intensitet: rolige minutter, kvalitetsminutter, og grått som residual.
 *
 * ## Hvorfor tre mengder og ikke tre bøtter
 *
 * Fram til september 2026 klassifiserte `session-character.ts` hver økt som
 * rolig, grå eller hard. Tersklene var gjetninger som ikke kunne begrunnes, og
 * 2. september ga de «72 % hard» over nitti dager for en bruker hvis egne økter
 * lå på puls 120–136.
 *
 * Feilen var ikke tallet, det var FORMEN. En binær etikett gjør et
 * grensetilfelle katastrofalt: fire oppsamlede minutter over Z4 gjorde en kupert
 * rolig tur til «hard økt». Som mengde er samme fire minutter bare fire minutter.
 *
 * ## Og hvorfor forholdstallet ikke er målet
 *
 * 80/20 kan oppfylles helt feil — 80 % grått og 20 % grått gir også 80/20.
 * Det er to UAVHENGIGE tilstrekkelighetsspørsmål:
 *
 * - Er de rolige øktene faktisk rolige? (rolige minutter, og at grået er lite)
 * - Får du nok kvalitetsminutter? (et absolutt tall, ikke en andel)
 *
 * Man kan svare ja på det ene og nei på det andre, og et forholdstall skjuler
 * nettopp det. Derfor er alt her i MINUTTER, aldri normalisert.
 *
 * ## Grået kan ikke bli null, og flaten skal ikke påstå noe annet
 *
 * Oppvarming, nedjogg, joggen til start og bakkene på en rolig tur lander alle i
 * midten. Vi setter derfor ikke et gulv her: `describeWeek` sier tallene uten en
 * dom til vi har nok uker å lese brukerens eget gulv av.
 */

/** Én økts tidsdeling, slik `computeIntensitySplit` regner den. */
export interface SessionIntensity {
	/** Oslo-dagen økta hører til. */
	date: string;
	easySeconds: number;
	greySeconds: number;
	qualitySeconds: number;
	measuredSeconds: number;
}

export interface WeekIntensity {
	/** Mandagen uka starter på, som `YYYY-MM-DD`. */
	weekStart: string;
	easyMinutes: number;
	greyMinutes: number;
	qualityMinutes: number;
	/** Sum av de tre. Bjelkens LENGDE — altså ukas volum. */
	totalMinutes: number;
	/** Antall økter med brukbar puls i uka. */
	sessions: number;
	/** Andel av totalen som er grått (0–1). `null` i en tom uke. */
	greyShare: number | null;
}

/**
 * Mandagen en Oslo-dag hører til.
 *
 * Regner på datostrengen framfor på en `Date`, og gjenbruker derfor IKKE
 * `startOfWeekMondayMs` i `workout-nugget-rules.ts`: den bruker `getDay`/
 * `setHours`, altså serverens lokale tid, som er UTC i drift. En uke ankret i UTC
 * og en dag nøklet i Oslo-tid ville lagt en søndagskveldsøkt i feil uke.
 */
export function mondayOf(dayKey: string): string {
	const [y, m, d] = dayKey.split('-').map(Number);
	const at = new Date(Date.UTC(y, m - 1, d));
	// getUTCDay: 0 = søndag. Mandag som ukestart gir offset (dag + 6) % 7.
	const offset = (at.getUTCDay() + 6) % 7;
	at.setUTCDate(at.getUTCDate() - offset);
	return at.toISOString().slice(0, 10);
}

/** Alle mandager fra og med `fromWeek` til og med `toWeek`, stigende. */
function weeksBetween(fromWeek: string, toWeek: string): string[] {
	const out: string[] = [];
	let at = fromWeek;
	while (at <= toWeek) {
		out.push(at);
		const [y, m, d] = at.split('-').map(Number);
		at = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
	}
	return out;
}

/**
 * Grupperer øktene i mandag-ankrede uker.
 *
 * **Uker uten økter kommer med som nuller, ikke som hull.** En uke man ikke
 * trente er informasjon om treningen; utelot vi den, ville tolv bjelker dekket et
 * halvår og aksen løyet om tempoet. Samme regel som at en hvileuke teller som 0 i
 * effort-ankeret.
 */
export function buildWeeklyIntensity(
	sessions: readonly SessionIntensity[],
	options: { today: string; weeks: number }
): WeekIntensity[] {
	const { today, weeks } = options;
	const thisWeek = mondayOf(today);
	const [y, m, d] = thisWeek.split('-').map(Number);
	const firstWeek = new Date(Date.UTC(y, m - 1, d - (weeks - 1) * 7))
		.toISOString()
		.slice(0, 10);

	const byWeek = new Map<string, { easy: number; grey: number; quality: number; sessions: number }>();
	for (const week of weeksBetween(firstWeek, thisWeek)) {
		byWeek.set(week, { easy: 0, grey: 0, quality: 0, sessions: 0 });
	}

	for (const session of sessions) {
		const week = mondayOf(session.date);
		const bucket = byWeek.get(week);
		// Økter utenfor vinduet ignoreres i stillhet: kalleren leser bredere enn
		// grafen tegner, og det er meningen.
		if (!bucket) continue;
		bucket.easy += session.easySeconds;
		bucket.grey += session.greySeconds;
		bucket.quality += session.qualitySeconds;
		bucket.sessions += 1;
	}

	return [...byWeek.entries()].map(([weekStart, b]) => {
		const easyMinutes = Math.round(b.easy / 60);
		const greyMinutes = Math.round(b.grey / 60);
		const qualityMinutes = Math.round(b.quality / 60);
		const totalMinutes = easyMinutes + greyMinutes + qualityMinutes;
		return {
			weekStart,
			easyMinutes,
			greyMinutes,
			qualityMinutes,
			totalMinutes,
			sessions: b.sessions,
			greyShare: totalMinutes > 0 ? greyMinutes / totalMinutes : null
		};
	});
}

export interface IntensityTotals {
	easyMinutes: number;
	greyMinutes: number;
	qualityMinutes: number;
	totalMinutes: number;
	weeks: number;
	/** Uker med minst én økt — nevneren for et snitt per uke. */
	activeWeeks: number;
	greyShare: number | null;
	/** Kvalitetsminutter per AKTIVE uke. `null` uten aktive uker. */
	qualityPerActiveWeek: number | null;
}

/**
 * Summen over vinduet, med snitt per AKTIV uke.
 *
 * Nevneren er aktive uker og ikke alle uker, fordi to hvileuker ellers halverer
 * «kvalitetsminutter per uke» og får treningen til å se tynnere ut enn den var.
 * Antall uker rapporteres ved siden av, så forskjellen er synlig.
 */
export function totalsFor(weeks: readonly WeekIntensity[]): IntensityTotals {
	const easyMinutes = weeks.reduce((n, w) => n + w.easyMinutes, 0);
	const greyMinutes = weeks.reduce((n, w) => n + w.greyMinutes, 0);
	const qualityMinutes = weeks.reduce((n, w) => n + w.qualityMinutes, 0);
	const totalMinutes = easyMinutes + greyMinutes + qualityMinutes;
	const activeWeeks = weeks.filter((w) => w.sessions > 0).length;
	return {
		easyMinutes,
		greyMinutes,
		qualityMinutes,
		totalMinutes,
		weeks: weeks.length,
		activeWeeks,
		greyShare: totalMinutes > 0 ? greyMinutes / totalMinutes : null,
		qualityPerActiveWeek: activeWeeks > 0 ? Math.round(qualityMinutes / activeWeeks) : null
	};
}

/**
 * Under så mange aktive uker sier vi tallene uten å tolke dem.
 *
 * Fire uker er nok til at et mønster begynner å finnes, og for få til at én uke
 * avgjør. Samme forsiktighet som `MIN_OBSERVATIONS` i sultprediksjonen.
 */
export const MIN_WEEKS_FOR_PATTERN = 4;

/**
 * Setningen flaten og chatten deler.
 *
 * Bærer forbeholdene: at grået aldri blir null, og at vi ikke vet hvor
 * brukerens eget gulv ligger ennå. Uten dem leses et grå-tall som en anklage —
 * og en graf som anklager permanent er en graf man slutter å åpne.
 */
export function describeWeeklyIntensity(totals: IntensityTotals): string {
	if (totals.totalMinutes === 0) {
		return `Ingen økter med pulskurve de siste ${totals.weeks} ukene.`;
	}

	const parts = [
		`${totals.easyMinutes} min rolig, ${totals.qualityMinutes} min kvalitet, ${totals.greyMinutes} min i midten — over ${totals.activeWeeks} ${totals.activeWeeks === 1 ? 'uke' : 'uker'} med trening.`
	];

	if (totals.qualityPerActiveWeek !== null) {
		parts.push(`${totals.qualityPerActiveWeek} kvalitetsminutter per uke i snitt.`);
	}

	if (totals.activeWeeks < MIN_WEEKS_FOR_PATTERN) {
		parts.push('For få uker til å si om det er et mønster.');
	} else {
		// Ingen terskel her: brukerens eget gulv er ukjent til vi har sett noen
		// uker med det nye målet. Vi sier hva som er, og hva det betyr.
		parts.push(
			'Midten er tida som er for hard til å bygge grunnmur billig og for kort til å flytte terskelen. Den blir aldri null — oppvarming, nedjogg og bakker på rolige turer havner der.'
		);
	}

	return parts.join(' ');
}
