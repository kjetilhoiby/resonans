/**
 * Pulskostnaden ved en gitt fart — og hvordan den flytter seg over tid.
 *
 * Se `docs/changelog/2026-08-11-efficiency-factor.md`.
 *
 * **Hvorfor ikke VO2max.** VDOT antar maksimal innsats. Brukeren racer ikke, så
 * estimatet leser ~9 poeng lavere enn Withings' måling på samme økt (33,7 mot
 * 42,8), og en uke uten Withings-måling gir et fantomfall. Tallet svarer i
 * praksis på «løp du hardt denne uka», ikke på «har formen flyttet seg».
 *
 * **Efficiency Factor gjør det motsatte:** den er best på ROLIGE, jevne økter,
 * og måler nettopp hvor mye fart du får per hjerteslag. Stiger den over uker,
 * ligger puls/fart-kurven flatere. Ingen maksimaltest, ingen makspuls-antakelse.
 *
 * To mål som svarer på ulike spørsmål, og som ikke må forveksles:
 *
 * - **EF** (`efficiencyFactor`): «er jeg raskere per slag enn før?» — over uker.
 * - **Decoupling** (`aerobicDecoupling`): «holder jeg det ut?» — innad i én økt.
 *
 * Ren modul: tar økter inn, gir tall ut.
 */

/** Grunnlaget for én EF-observasjon. */
export type EfficiencySession = {
	startTime: Date;
	sportFamily: string;
	/** Bakkekorrigert tempo, sekunder per km. Rått tempo duger ikke — se under. */
	gapSecPerKm: number | null;
	avgHeartRate: number | null;
	durationSeconds: number | null;
	/** Andel av tida i sone 4 og 5. Skiller en jevn økt fra en intervalløkt. */
	hardShare: number | null;
};

export type EfficiencyPoint = {
	date: Date;
	/** Meter per minutt per hjerteslag. Typisk 1,3–2,0 for løping. */
	ef: number;
};

/**
 * Korteste økt vi regner EF på.
 *
 * Under tjue minutter dominerer oppvarmingen: pulsen henger etter farten de
 * første minuttene, så EF kommer kunstig høyt ut. Det er ikke form, det er
 * treghet i pulsresponsen.
 */
export const MIN_DURATION_SEC = 20 * 60;

/**
 * Mest tid i sone 4–5 en økt kan ha og fortsatt telle.
 *
 * En intervalløkt har høy puls for sin snittfart — pausene drar snittfarten ned
 * mens pulsen holder seg oppe — så den gir kunstig lav EF. Tar man dem med,
 * måler trenden hvor mange intervalløkter man har hatt, ikke formen.
 */
export const MAX_HARD_SHARE = 0.25;

/**
 * Bare løping.
 *
 * På sykkel avgjøres farten av terreng, vind og — på el-sykkel — hvor mye
 * motoren ga. Fart per hjerteslag måler da utstyret, ikke deg.
 */
export const EF_SPORT_FAMILY = 'running';

/** Rullende vindu for trenden. */
export const TREND_WINDOW_DAYS = 28;

/**
 * Færre observasjoner enn dette gir ingen trend.
 *
 * EF svinger med varme, underlag og dagsform. Tre økter er et tilfeldig utvalg
 * av den støyen; en «forbedring» regnet fra to turer er en gjetning med
 * selvtillit.
 */
export const MIN_SESSIONS_FOR_TREND = 4;

/**
 * Endring under dette kalles uendret.
 *
 * EF varierer 3–5 % mellom to like økter på ulike dager. Under gulvet er et
 * utslag støy, og å presentere det som framgang er å love noe vi ikke har målt.
 */
export const EF_NOISE_SHARE = 0.03;

/** Er økta egnet til å måle EF på? */
export function qualifiesForEfficiency(session: EfficiencySession): boolean {
	if (session.sportFamily !== EF_SPORT_FAMILY) return false;
	if (session.gapSecPerKm == null || session.gapSecPerKm <= 0) return false;
	if (session.avgHeartRate == null || session.avgHeartRate <= 0) return false;
	if (session.durationSeconds == null || session.durationSeconds < MIN_DURATION_SEC) return false;
	// Ukjent soneprofil slippes gjennom: en økt uten sonedata er som regel en
	// vanlig tur, og å kreve dataene ville tømt serien for eldre økter.
	if (session.hardShare != null && session.hardShare > MAX_HARD_SHARE) return false;
	return true;
}

/**
 * Meter per minutt per hjerteslag, bakkekorrigert.
 *
 * `gapSecPerKm` og ikke rått tempo: 234 høydemeter på 8 km gjør rå fart
 * ubrukelig som sammenligningsgrunnlag, og terreng er den største
 * forvekslingsfaren i akkurat denne målingen.
 */
export function efficiencyFactor(session: EfficiencySession): number | null {
	if (!qualifiesForEfficiency(session)) return null;
	const metersPerMinute = 60_000 / (session.gapSecPerKm as number);
	return metersPerMinute / (session.avgHeartRate as number);
}

export function efficiencySeries(sessions: EfficiencySession[]): EfficiencyPoint[] {
	return sessions
		.map((s) => ({ date: s.startTime, ef: efficiencyFactor(s) }))
		.filter((p): p is EfficiencyPoint => p.ef !== null)
		.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianInWindow(points: EfficiencyPoint[], end: Date, windowDays: number): { value: number | null; count: number } {
	const start = end.getTime() - windowDays * 24 * 60 * 60 * 1000;
	const inWindow = points.filter((p) => p.date.getTime() > start && p.date.getTime() <= end.getTime());
	return { value: median(inWindow.map((p) => p.ef)), count: inWindow.length };
}

export type EfficiencyTrend = {
	/** Median EF i det siste vinduet. */
	current: number | null;
	/** Median EF i et like langt vindu, `comparisonWeeksBack` uker tidligere. */
	previous: number | null;
	changeShare: number | null;
	direction: 'bedre' | 'dårligere' | 'uendret' | 'ukjent';
	currentCount: number;
	previousCount: number;
	/** Sant når ett av vinduene har for få økter til at sammenligningen betyr noe. */
	insufficient: boolean;
};

/**
 * «Ligger kurven flatere nå enn for to måneder siden?»
 *
 * Medianen og ikke snittet: én tur i tretti grader skal ikke flytte «vanlig».
 */
export function efficiencyTrend(
	points: EfficiencyPoint[],
	now: Date,
	comparisonWeeksBack = 8,
	windowDays = TREND_WINDOW_DAYS
): EfficiencyTrend {
	const earlier = new Date(now.getTime() - comparisonWeeksBack * 7 * 24 * 60 * 60 * 1000);
	const cur = medianInWindow(points, now, windowDays);
	const prev = medianInWindow(points, earlier, windowDays);

	const insufficient =
		cur.count < MIN_SESSIONS_FOR_TREND || prev.count < MIN_SESSIONS_FOR_TREND;

	if (cur.value === null || prev.value === null || prev.value === 0) {
		return {
			current: cur.value,
			previous: prev.value,
			changeShare: null,
			direction: 'ukjent',
			currentCount: cur.count,
			previousCount: prev.count,
			insufficient: true
		};
	}

	const changeShare = (cur.value - prev.value) / prev.value;
	const direction: EfficiencyTrend['direction'] = insufficient
		? 'ukjent'
		: Math.abs(changeShare) < EF_NOISE_SHARE
			? 'uendret'
			: changeShare > 0
				? 'bedre'
				: 'dårligere';

	return {
		current: cur.value,
		previous: prev.value,
		changeShare,
		direction,
		currentCount: cur.count,
		previousCount: prev.count,
		insufficient
	};
}

// ─── Aerob decoupling ────────────────────────────────────────────────────────

export type DecouplingSample = {
	/** Sekunder fra start. */
	tSec: number;
	/** Kumulativ distanse i meter. */
	distanceM: number;
	hr: number | null;
};

/**
 * Minste antall punkter med puls i HVER halvdel.
 *
 * En halvdel med tre pulsmålinger gir et snitt som er en tilfeldighet, og
 * differansen mellom to slike er ren støy.
 */
export const MIN_SAMPLES_PER_HALF = 20;

export type Decoupling = {
	/** Prosent. Positivt = pulsen dro oppover i forhold til farten. */
	driftPct: number;
	firstHalfRatio: number;
	secondHalfRatio: number;
	/** Under 5 % regnes som god aerob utholdenhet. */
	good: boolean;
};

/**
 * Hvor mye fart-per-slag falt fra første til andre halvdel av økta.
 *
 * Halvdelene deles på TID, ikke på distanse: blir man tregere utover, dekker
 * andre halvdel færre meter, og en distansedeling ville flyttet skillet inn i
 * den friske delen og underdrevet driften.
 *
 * Returnerer null når økta ikke har nok pulsdata til at tallet betyr noe.
 */
export function aerobicDecoupling(samples: DecouplingSample[]): Decoupling | null {
	if (samples.length < MIN_SAMPLES_PER_HALF * 2) return null;

	const sorted = [...samples].sort((a, b) => a.tSec - b.tSec);
	const start = sorted[0];
	const end = sorted[sorted.length - 1];
	const totalSec = end.tSec - start.tSec;
	if (totalSec <= 0) return null;

	const midSec = start.tSec + totalSec / 2;
	const halves: Array<DecouplingSample[]> = [
		sorted.filter((s) => s.tSec <= midSec),
		sorted.filter((s) => s.tSec > midSec)
	];

	const ratios: number[] = [];
	for (const half of halves) {
		const withHr = half.filter((s) => s.hr != null && s.hr > 0);
		if (withHr.length < MIN_SAMPLES_PER_HALF) return null;

		const spanSec = half[half.length - 1].tSec - half[0].tSec;
		const spanM = half[half.length - 1].distanceM - half[0].distanceM;
		if (spanSec <= 0 || spanM <= 0) return null;

		const metersPerMinute = spanM / (spanSec / 60);
		const meanHr = withHr.reduce((sum, s) => sum + (s.hr as number), 0) / withHr.length;
		if (meanHr <= 0) return null;

		ratios.push(metersPerMinute / meanHr);
	}

	const [first, second] = ratios;
	const driftPct = ((first - second) / first) * 100;
	return {
		driftPct: Math.round(driftPct * 10) / 10,
		firstHalfRatio: first,
		secondHalfRatio: second,
		good: driftPct < 5
	};
}
