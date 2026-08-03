/**
 * Pulsfall etter innsats (heart rate recovery), og diagnostikken som avgjør om
 * vi i det hele tatt kan regne det.
 *
 * ## Hvorfor øktfiler ikke holder
 *
 * HRR60 er fallet i de 60 sekundene ETTER at du stoppet. En `.gpx`/`.tcx` fra
 * iSmoothRun slutter å skrive når du trykker stopp, så nettopp de sekundene
 * mangler. Trackpoints har puls i ~1,4 sekunders oppløsning på en 45-minutters
 * økt — rikelig — men halen finnes ikke.
 *
 * Løsningen er en pulsserie som er *uavhengig* av økter. Det er det Tempo får
 * fra HealthKit, og det Withings gir via `getintradayactivity`.
 *
 * ## Hvorfor diagnostikken kommer først
 *
 * Tilgang er ikke problemet — samplingsfrekvens er. ScanWatch måler ofte hvert
 * 10. minutt i ro. Faller den tilbake til det rett etter at økta stoppet, er et
 * 60-sekunders fall umulig å regne uansett hvor pen koden er.
 * `summarizeSampling` svarer på det empirisk før noe bygges videre.
 */

export interface HrSample {
	/** ISO-tidspunkt. */
	at: string;
	bpm: number;
}

/**
 * Beskrivelse av punktavstanden i et vindu. Ren diagnostikk.
 *
 * NB: dette er **ikke** en test på om HRR60 kan regnes. Withings skrur opp
 * frekvensen under og rett etter aktivitet, og faller tilbake til 10-minutters
 * intervaller først et kvarter senere. Medianen over et døgn blander de to
 * modusene og lander på 30–170 s selv når det lokalt er 8–30 s rundt økta. Om
 * fallet kan måles avgjøres av om `bestRecoveryNearEffortEnd` finner et brukbart
 * punktpar — ikke av en median. Se `2026-08-03-hr-recovery-diagnose.md`.
 */
export interface SamplingSummary {
	count: number;
	/** Første og siste tidspunkt i vinduet. */
	firstAt: string | null;
	lastAt: string | null;
	/** Sekunder mellom påfølgende punkter. */
	medianGapSeconds: number | null;
	minGapSeconds: number | null;
	maxGapSeconds: number | null;
}

function sortByTime(samples: HrSample[]): HrSample[] {
	return [...samples]
		.filter((s) => Number.isFinite(new Date(s.at).getTime()) && Number.isFinite(s.bpm) && s.bpm > 0)
		.sort((a, b) => a.at.localeCompare(b.at));
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Punktavstanden i et vindu — svaret på «holder oppløsningen?». */
export function summarizeSampling(samples: HrSample[]): SamplingSummary {
	const sorted = sortByTime(samples);
	if (sorted.length === 0) {
		return {
			count: 0,
			firstAt: null,
			lastAt: null,
			medianGapSeconds: null,
			minGapSeconds: null,
			maxGapSeconds: null
		};
	}

	const gaps: number[] = [];
	for (let i = 1; i < sorted.length; i++) {
		const delta = (new Date(sorted[i].at).getTime() - new Date(sorted[i - 1].at).getTime()) / 1000;
		if (delta > 0) gaps.push(delta);
	}

	const medianGap = gaps.length > 0 ? median(gaps) : null;

	return {
		count: sorted.length,
		firstAt: sorted[0].at,
		lastAt: sorted[sorted.length - 1].at,
		medianGapSeconds: medianGap === null ? null : Math.round(medianGap),
		minGapSeconds: gaps.length > 0 ? Math.round(Math.min(...gaps)) : null,
		maxGapSeconds: gaps.length > 0 ? Math.round(Math.max(...gaps)) : null
	};
}

/** Punktene innenfor et tidsvindu, sortert. */
export function sliceWindow(samples: HrSample[], fromMs: number, toMs: number): HrSample[] {
	return sortByTime(samples).filter((s) => {
		const t = new Date(s.at).getTime();
		return t >= fromMs && t <= toMs;
	});
}

export interface HrRecoveryInput {
	samples: HrSample[];
	/** Når innsatsen sluttet — øktas sluttid. */
	effortEndAt: string;
	/** Hvor mange sekunder etter slutt vi måler fallet. Standard 60. */
	windowSeconds?: number;
	/**
	 * Hvor langt fra måltidspunktet et punkt får ligge. Uten toleranse ville et
	 * punkt på 58 eller 63 sekunder blitt forkastet, og da finner man nesten aldri
	 * et treff.
	 */
	toleranceSeconds?: number;
}

export interface HrRecovery {
	/** Puls ved slutt av innsats. */
	endBpm: number;
	/** Puls ved måltidspunktet. */
	recoveredBpm: number;
	/** Fallet i slag. Positivt = pulsen falt, som er det normale. */
	dropBpm: number;
	/** Faktisk antall sekunder etter slutt målingen ble gjort. */
	atSeconds: number;
	band: 'svak' | 'moderat' | 'god';
}

/**
 * Tersklene for HRR60.
 *
 * Under 12 slags fall regnes klinisk som svakt; over 20 som godt. De er grove og
 * aldersuavhengige, i samme ånd som `vo2maxBand` — et fall målt av en klokke
 * fortjener ikke mer presisjon enn det.
 */
export const RECOVERY_WEAK_BELOW = 12;
export const RECOVERY_GOOD_ABOVE = 20;

export function classifyRecovery(dropBpm: number): HrRecovery['band'] {
	if (dropBpm < RECOVERY_WEAK_BELOW) return 'svak';
	if (dropBpm > RECOVERY_GOOD_ABOVE) return 'god';
	return 'moderat';
}

/**
 * Pulsfallet etter en økt.
 *
 * Null når vi mangler et punkt nær slutt eller nær måltidspunktet. Det er en
 * ærlig null: å bruke nærmeste punkt uansett avstand ville gitt «fallet etter 8
 * minutter» presentert som HRR60.
 */
export function computeHrRecovery(input: HrRecoveryInput): HrRecovery | null {
	const windowSeconds = input.windowSeconds ?? 60;
	const tolerance = input.toleranceSeconds ?? 15;
	const endMs = new Date(input.effortEndAt).getTime();
	if (!Number.isFinite(endMs)) return null;

	const sorted = sortByTime(input.samples);
	if (sorted.length < 2) return null;

	const withOffset = sorted.map((s) => ({
		...s,
		offset: (new Date(s.at).getTime() - endMs) / 1000
	}));

	const nearest = (target: number) => {
		let best: (typeof withOffset)[number] | null = null;
		for (const sample of withOffset) {
			const distance = Math.abs(sample.offset - target);
			if (distance > tolerance) continue;
			if (!best || distance < Math.abs(best.offset - target)) best = sample;
		}
		return best;
	};

	const atEnd = nearest(0);
	const atWindow = nearest(windowSeconds);
	if (!atEnd || !atWindow) return null;
	// Samme punkt for begge betyr at serien er for grov til å se et fall.
	if (atEnd.at === atWindow.at) return null;

	const dropBpm = Math.round(atEnd.bpm - atWindow.bpm);

	return {
		endBpm: Math.round(atEnd.bpm),
		recoveredBpm: Math.round(atWindow.bpm),
		dropBpm,
		atSeconds: Math.round(atWindow.offset),
		band: classifyRecovery(dropBpm)
	};
}

export interface AnchoredHrRecovery {
	/** Tidspunktet fallet måles fra — funnet i pulsserien. */
	anchorAt: string;
	/** Hvor ankeret ligger i forhold til øktas oppgitte slutt. Negativt = før. */
	anchorOffsetSeconds: number;
	/** Puls ved ankeret. */
	endBpm: number;
	recoveredBpm: number;
	dropBpm: number;
	/** Faktisk avstand mellom de to punktene. */
	spanSeconds: number;
	band: HrRecovery['band'];
	/** Høyeste puls i søkevinduet, så et mistenkelig anker er synlig. */
	peakBpm: number;
	peakOffsetSeconds: number;
}

/** Hvor langt før og etter oppgitt slutt vi leter etter ankeret. */
export const SEARCH_BEFORE_SECONDS = 120;
export const SEARCH_AFTER_SECONDS = 180;

/**
 * Terskler for å avvise sensorbrudd forkledd som pulsfall.
 *
 * Fra el-sykkelturen 28. juli: 119 slag, og 8 sekunder senere 78. Et fall på 41
 * slag på 8 sekunder er ikke fysiologi — det er den optiske sensoren som mister
 * og gjenvinner feste. Uten denne vakta plukker søket den kanten og rapporterer
 * et fall på 42 slag der det virkelige svaret er «ingen restitusjon å måle».
 *
 * Pulsen kan falle raskt rett etter maksimal innsats, men i størrelsesorden ett
 * slag per sekund. Vi krever både et betydelig fall og en urimelig rate før vi
 * avviser, slik at støy på to-sekunders punkter (±3 slag) ikke rammes.
 */
export const ARTEFACT_MIN_DROP = 20;
export const ARTEFACT_MAX_BPM_PER_SECOND = 2;

/** Sant hvis to nabopunkter faller raskere enn kroppen kan. */
function isImplausibleStep(from: HrSample, to: HrSample): boolean {
	const seconds = (new Date(to.at).getTime() - new Date(from.at).getTime()) / 1000;
	if (seconds <= 0) return false;
	const drop = from.bpm - to.bpm;
	if (drop < ARTEFACT_MIN_DROP) return false;
	return drop / seconds > ARTEFACT_MAX_BPM_PER_SECOND;
}

/**
 * Det bratteste 60-sekunders pulsfallet rundt slutten av en økt.
 *
 * ## Hvorfor ikke bare måle fra øktas sluttid
 *
 * Fordi den lyver, målt på ekte data. Toppulsen ligger 17–105 sekunder **før**
 * oppgitt slutt: man slutter å presse, jogger eller går ut, og trykker stopp
 * etterpå. Måler man fra det oppgitte tidspunktet, er halve fallet alt skjedd.
 *
 * På løpeturen 1. august ga oppgitt slutt et fall på **1 slag** der det virkelige
 * fallet var **29**. På en el-sykkeltur ga det **−6** — altså «pulsen steg» — der
 * fallet var 42. Det er ikke en unøyaktighet, det er motsatt svar.
 *
 * Så vi leter i stedet etter det bratteste fallet i et vindu rundt slutten.
 * Det er samme fysiologi, det er sammenlignbart fra økt til økt, og det er
 * immunt mot når stoppknappen ble trykket.
 *
 * `anchorOffsetSeconds` og `peakBpm` er med i svaret nettopp fordi metoden er en
 * heuristikk: ligger ankeret langt fra slutten, eller langt under toppen, skal
 * leseren kunne se det.
 *
 * Null når serien ikke har et brukbart punktpar i vinduet.
 */
/** Inneholder strekket mellom anker og måling et umulig sprang? */
function spanHasArtefact(samples: HrSample[], anchorAt: string, spanSeconds: number): boolean {
	const from = new Date(anchorAt).getTime();
	const within = sliceWindow(samples, from, from + spanSeconds * 1000);
	for (let i = 1; i < within.length; i++) {
		if (isImplausibleStep(within[i - 1], within[i])) return true;
	}
	return false;
}

export function bestRecoveryNearEffortEnd(input: {
	samples: HrSample[];
	effortEndAt: string;
	searchBeforeSeconds?: number;
	searchAfterSeconds?: number;
	windowSeconds?: number;
	toleranceSeconds?: number;
}): AnchoredHrRecovery | null {
	const endMs = new Date(input.effortEndAt).getTime();
	if (!Number.isFinite(endMs)) return null;

	const before = input.searchBeforeSeconds ?? SEARCH_BEFORE_SECONDS;
	const after = input.searchAfterSeconds ?? SEARCH_AFTER_SECONDS;
	const candidates = sliceWindow(input.samples, endMs - before * 1000, endMs + after * 1000);
	if (candidates.length < 2) return null;

	const peak = candidates.reduce((a, b) => (b.bpm > a.bpm ? b : a));

	let best: AnchoredHrRecovery | null = null;
	for (const anchor of candidates) {
		const measured = computeHrRecovery({
			samples: candidates,
			effortEndAt: anchor.at,
			windowSeconds: input.windowSeconds,
			toleranceSeconds: input.toleranceSeconds
		});
		if (!measured) continue;
		// Størst fall vinner; ved likhet det tidligste ankeret, så svaret er
		// deterministisk uansett rekkefølge inn.
		if (best && measured.dropBpm <= best.dropBpm) continue;
		if (spanHasArtefact(candidates, anchor.at, measured.atSeconds)) continue;

		best = {
			anchorAt: anchor.at,
			anchorOffsetSeconds: Math.round((new Date(anchor.at).getTime() - endMs) / 1000),
			endBpm: measured.endBpm,
			recoveredBpm: measured.recoveredBpm,
			dropBpm: measured.dropBpm,
			spanSeconds: measured.atSeconds,
			band: measured.band,
			peakBpm: peak.bpm,
			peakOffsetSeconds: Math.round((new Date(peak.at).getTime() - endMs) / 1000)
		};
	}

	return best;
}

/**
 * Withings' intraday-serie → pulspunkter.
 *
 * Svaret er et OBJEKT nøklet på unix-tidsstempel, ikke en array — så
 * `fetchAllWithingsData`, som antar `body.series` er en liste, ville stille
 * droppet alt. Derfor egen parsing.
 */
export function parseIntradayHeartRate(series: unknown): HrSample[] {
	if (!series || typeof series !== 'object') return [];

	const samples: HrSample[] = [];
	for (const [key, value] of Object.entries(series as Record<string, unknown>)) {
		const unix = Number(key);
		if (!Number.isFinite(unix) || unix <= 0) continue;
		const entry = (value ?? {}) as Record<string, unknown>;
		const bpm = entry.heart_rate;
		if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) continue;
		samples.push({ at: new Date(unix * 1000).toISOString(), bpm });
	}

	return sortByTime(samples);
}
