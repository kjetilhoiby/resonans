/**
 * Triage ved import: finn øktene som ikke skal telle, FØR de teller.
 *
 * En arkivimport henter tolv år på én gang, og de radene lander rett i lister
 * som er «min over alt» eller «snitt over alt». Én søppelrad er derfor ikke én
 * dårlig rad — den er en rekord, en trend eller en formkurve som er gal fra da
 * av. Fire akser, og de har HVER SIN skade nedstrøms:
 *
 * | Akse | Hva som er galt | Hvem som betaler |
 * |------|-----------------|------------------|
 * | for-rask | feil sport, GPS-hopp, kjøring | distanserekorder — permanent, «min» glemmer ikke |
 * | for-langsom | gåtur merket som løp | tempo- og EF-trender |
 * | for-kort | GPS-fragment, glemt start | øktantall, streaks, «nr. 50 i år» |
 * | for-lang | glemt å stoppe sporingen | effort (`data.duration` er elapsed) |
 *
 * **Ranger, ikke bestå/stryk.** Modulen dømmer ingenting bort: den sorterer
 * etter hvor langt utenfor raden ligger, og sier hvorfor og hva det koster.
 * Samme grunn som `suggestForgottenTracking` er et forslag og ikke en
 * korreksjon — en feil gjetning skal koste brukeren et blikk, ikke et tall hen
 * må oppdage senere.
 *
 * Ren modul: tar sammendragsfelt (det en CSV-eksport har), ikke trackPoints.
 */

import { workoutSportFamily } from './workout-sport';

/** Én kandidat til import, beskrevet med det en eksport-oversikt bærer. */
export type TriageCandidate = {
	/** Ekstern id — det man slår opp raden på hos kilden. */
	id: string;
	/** Dato som tekst; brukes bare i rapporten, aldri i en beregning. */
	date: string;
	name: string | null;
	/** Rå sportstype fra kilden; familien utledes med `workoutSportFamily`. */
	sportType: string | null;
	distanceMeters: number | null;
	/** Elapsed — fra stopp- til startknapp, altså det effort skåres på. */
	elapsedSeconds: number | null;
	/** Bevegelsestid der kilden har den. `null` = aksen kan ikke dømmes. */
	movingSeconds: number | null;
};

export type TriageAxis = 'for-rask' | 'for-langsom' | 'for-kort' | 'for-lang';

export type TriageFinding = {
	axis: TriageAxis;
	/** 0..1 — hvor langt utenfor. Rangerer lista; ikke en sannsynlighet. */
	severity: number;
	/**
	 * Hvor mange ganger utenfor terskelen målingen ligger. 1 = på terskelen.
	 *
	 * **Feltet finnes fordi `severity` ikke kan skille et grensetilfelle fra et
	 * grovt avvik på en måte man kan sette en grense på.** Målt på arkivet:
	 * en økt fire SEKUNDER raskere enn brukerens egen kurve gir severity 0,002,
	 * og en 18 % raskere gir 0,153 — begge små tall nær null. En port som skal
	 * slippe den første og stoppe den andre må lese forholdstallet (1,002 mot
	 * 1,18), som er det tallet regelen faktisk handler om.
	 */
	ratio: number;
	/** Hva som er målt, med tallene i. */
	reason: string;
	/** Hva denne raden ødelegger hvis den slipper inn. */
	consequence: string;
};

export type TriageResult = {
	candidate: TriageCandidate;
	findings: TriageFinding[];
	/** Høyeste severity blant funnene — lista sorteres på denne. */
	worst: number;
};

/**
 * Brukerens egen referanse for hva som er raskt: en distanse og en tid hen
 * faktisk har løpt.
 *
 * **Dette er en PARAMETER, aldri en konstant.** Et hardkodet tempo arver
 * stille feilen i den kroppen det en gang ble satt for — samme lærdom som
 * `MET_CALIBRATION`, der 2,5 svarte til en HRR modellen aldri hadde ment.
 * Referansen skal kunne endres når brukeren løper fortere, uten at noen må
 * huske at et tall i en fil betyr noe.
 */
export type PaceReference = { distanceMeters: number; seconds: number };

/**
 * Riegel: `T2 = T1 × (D2/D1)^1.06`.
 *
 * Eksponenten er den etablerte, og den gjør sammenligningen distanse-uavhengig:
 * uten den må terskelen settes per distanse, og da er den fire tall som kan
 * drive fra hverandre.
 */
export const RIEGEL_EXPONENT = 1.06;

/**
 * Riegel er validert fra omtrent 1500 m og opp.
 *
 * Ekstrapolert NEDOVER til 400 m spår den for treg tid, så en helt normal
 * 400-meter ville blitt flagget. Da er aksen støy, og en rapport man slutter å
 * lese er verre enn ingen rapport. Korte distanser dømmes derfor bare av
 * for-kort-aksen.
 */
export const MIN_PACE_AXIS_METERS = 1500;

/**
 * Hvor mye raskere enn referansekurven en tid må være for å bli flagget.
 *
 * 1,0 betyr «på eller raskere enn din egen PR-kurve». Det er strengt med
 * vilje: en PR er per definisjon det raskeste som har skjedd, så alt som
 * ligger der eller under er verdt et blikk. Og siden lista rangerer, koster et
 * grensetilfelle ingenting.
 */
export const PACE_SUSPECT_RATIO = 1.0;

/**
 * Tregere enn dette er ikke løping.
 *
 * 12:00/km er saktere enn rask gange. Målt på BEVEGELSESTID der den finnes —
 * ellers blander aksen seg med for-lang, og en løpetur med et langt kaffestopp
 * ville blitt «gåtur».
 */
export const MAX_RUN_SEC_PER_KM = 720;

/**
 * Distansegulv per sportsfamilie, i meter.
 *
 * Gulvet er sport-avhengig fordi et fragment er relativt: 800 m på sykkel er en
 * tur til butikken som ble avbrutt, 800 m til fots er en tur rundt kvartalet
 * som fant sted. Familier uten oppføring dømmes ikke på denne aksen — å gjette
 * et gulv for «tennis» er å finne opp en regel.
 */
export const MIN_DISTANCE_METERS_BY_FAMILY: Record<string, number> = {
	running: 500,
	cycling: 1000,
	e_bike: 1000,
	walking: 300,
	skiing: 500
};

/** Under dette er det ikke en økt, uansett idrett. */
export const MIN_ELAPSED_SECONDS = 180;

/**
 * Andel av økta man sto stille før den kalles for lang.
 *
 * Bevisst høyere enn `NOTABLE_STOPPED_SHARE` (0,2) i `moving-time.ts`: der er
 * spørsmålet «var det mye stopp i denne økta», som er interessant på en flate
 * du alt har åpnet. Her er spørsmålet «glemte jeg å stoppe klokka», og
 * bylufting med lyskryss ligger fint over 20 %.
 */
export const MAX_STOPPED_SHARE = 0.3;

/**
 * Absolutt gulv for hvor mye død tid som må til.
 *
 * Samme tall som `MIN_SUGGESTED_TRIM_SECONDS`, og av samme grunn: under ti
 * minutter er kuttet ikke verdt en handling.
 */
export const MIN_DEAD_SECONDS = 10 * 60;

/** Over dette har klokka stått på over natta, uansett hva forholdstallet sier. */
export const MAX_ELAPSED_SECONDS = 12 * 60 * 60;

/** Riegel-ekvivalent tid for `distanceMeters`, gitt referansen. */
export function riegelSeconds(reference: PaceReference, distanceMeters: number): number {
	return reference.seconds * Math.pow(distanceMeters / reference.distanceMeters, RIEGEL_EXPONENT);
}

function formatTime(seconds: number): string {
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(secPerKm: number): string {
	return `${formatTime(secPerKm)}/km`;
}

function formatKm(meters: number): string {
	return `${(meters / 1000).toFixed(2)} km`;
}

/** 0..1, der 1 er «langt utenfor». Monoton i avviket, uten en påstand om odds. */
function severityFromRatio(ratio: number): number {
	// ratio 1 = på terskelen, 2 = dobbelt så langt utenfor.
	return Math.min(1, Math.max(0, 1 - 1 / Math.max(ratio, 1e-6)));
}

export type TriageOptions = {
	/** Uten referanse hoppes for-rask-aksen — vi gjetter ikke et tempo. */
	paceReference?: PaceReference;
};

/**
 * Fire akser på én kandidat.
 *
 * Rekkefølgen i lista er ikke tilfeldig: `for-rask` først, siden den er den
 * ENESTE som er permanent — en distanserekord er «min over alt», og en gal
 * rekord blir stående til noen finner den.
 */
export function triageCandidate(
	candidate: TriageCandidate,
	options: TriageOptions = {}
): TriageFinding[] {
	const findings: TriageFinding[] = [];
	const family = workoutSportFamily(candidate.sportType);
	const distance = candidate.distanceMeters;
	const elapsed = candidate.elapsedSeconds;
	const moving = candidate.movingSeconds;

	// --- for-rask: bare løping, og bare over Riegels gyldige spenn ---------
	//
	// Farten på sykkel avgjøres av terreng, vind og motor, så en «rekord» der
	// er ikke sammenlignbar med noe. Samme begrunnelse som at tempo-rekorder i
	// krydderet bare gjelder løping.
	const paceRef = options.paceReference;
	if (
		paceRef &&
		family === 'running' &&
		distance != null &&
		distance >= MIN_PACE_AXIS_METERS &&
		moving != null &&
		moving > 0
	) {
		const expected = riegelSeconds(paceRef, distance);
		if (moving <= expected * PACE_SUSPECT_RATIO) {
			const ratio = expected / moving;
			findings.push({
				axis: 'for-rask',
				severity: severityFromRatio(ratio),
				ratio,
				reason:
					`${formatKm(distance)} på ${formatTime(moving)} ` +
					`(${formatPace((moving / distance) * 1000)}) — ` +
					`din egen kurve tilsier ${formatTime(expected)}`,
				consequence:
					'Blir en distanserekord som står til noen finner den, og drar VDOT med seg.'
			});
		}
	}

	// --- for-langsom: målt på bevegelsestid, ellers blir det for-lang -----
	const runSeconds = moving ?? elapsed;
	if (family === 'running' && distance != null && distance > 0 && runSeconds != null) {
		const secPerKm = (runSeconds / distance) * 1000;
		if (secPerKm > MAX_RUN_SEC_PER_KM) {
			findings.push({
				axis: 'for-langsom',
				severity: severityFromRatio(secPerKm / MAX_RUN_SEC_PER_KM),
				ratio: secPerKm / MAX_RUN_SEC_PER_KM,
				reason:
					`${formatPace(secPerKm)} over ${formatKm(distance)}` +
					(moving == null ? ' (målt på elapsed — bevegelsestid mangler)' : ''),
				consequence: 'Trekker tempo- og EF-trender ned; er antakelig en gåtur merket som løp.'
			});
		}
	}

	// --- for-kort: fragmentet som likevel teller som en økt ----------------
	const floor = MIN_DISTANCE_METERS_BY_FAMILY[family];
	if (floor != null && distance != null && distance > 0 && distance < floor) {
		findings.push({
			axis: 'for-kort',
			severity: severityFromRatio(floor / distance),
			ratio: floor / distance,
			reason: `${formatKm(distance)}, under gulvet på ${formatKm(floor)} for ${family}`,
			consequence: 'Teller som en økt i streaks og årsmilepæler uten å være en.'
		});
	}
	if (elapsed != null && elapsed > 0 && elapsed < MIN_ELAPSED_SECONDS) {
		findings.push({
			axis: 'for-kort',
			severity: severityFromRatio(MIN_ELAPSED_SECONDS / elapsed),
			ratio: MIN_ELAPSED_SECONDS / elapsed,
			reason: `${formatTime(elapsed)} totalt`,
			consequence: 'Teller som en økt i streaks og årsmilepæler uten å være en.'
		});
	}

	// --- for-lang: glemte å stoppe sporingen ------------------------------
	//
	// Spørsmålet er `suggestForgottenTracking` sitt, men her finnes ingen
	// trackPoints — bare gapet mellom elapsed og bevegelsestid, som kilden alt
	// har regnet. Den finere målingen hører i sporet; denne fanger tilfellet
	// før én fil er lastet ned.
	if (elapsed != null && moving != null && elapsed > 0 && moving > 0) {
		const dead = elapsed - moving;
		const share = dead / elapsed;
		if (share > MAX_STOPPED_SHARE && dead >= MIN_DEAD_SECONDS) {
			findings.push({
				axis: 'for-lang',
				severity: severityFromRatio(share / MAX_STOPPED_SHARE),
				ratio: share / MAX_STOPPED_SHARE,
				reason:
					`${formatTime(dead)} av ${formatTime(elapsed)} uten bevegelse ` +
					`(${Math.round(share * 100)} %)`,
				consequence: 'Effort skåres på elapsed, så den døde halen prises som trening.'
			});
		}
	}
	if (elapsed != null && elapsed > MAX_ELAPSED_SECONDS) {
		findings.push({
			axis: 'for-lang',
			severity: severityFromRatio(elapsed / MAX_ELAPSED_SECONDS),
			ratio: elapsed / MAX_ELAPSED_SECONDS,
			reason: `${formatTime(elapsed)} totalt — klokka har stått på`,
			consequence: 'Effort skåres på elapsed, så den døde halen prises som trening.'
		});
	}

	return findings;
}

/**
 * Hvor mange kandidater hver akse KUNNE dømme.
 *
 * «0 funn» og «0 vi kunne se etter» er ulike svar, og bare det andre betyr at
 * importen mangler et felt. Uten dekningstallene ser en eksport uten
 * bevegelsestid ut som en ren eksport.
 */
export type TriageCoverage = Record<TriageAxis, number>;

export type TriageReport = {
	/** Kandidater med minst ett funn, verste først. */
	flagged: TriageResult[];
	checked: number;
	byAxis: Record<TriageAxis, number>;
	coverage: TriageCoverage;
	/** Referansen som ble brukt, eller null — så rapporten kan etterprøves. */
	paceReference: PaceReference | null;
};

const AXES: TriageAxis[] = ['for-rask', 'for-langsom', 'for-kort', 'for-lang'];

function judgeable(candidate: TriageCandidate, options: TriageOptions): TriageAxis[] {
	const family = workoutSportFamily(candidate.sportType);
	const axes: TriageAxis[] = [];
	const { distanceMeters: d, elapsedSeconds: e, movingSeconds: m } = candidate;

	if (
		options.paceReference &&
		family === 'running' &&
		d != null &&
		d >= MIN_PACE_AXIS_METERS &&
		m != null &&
		m > 0
	) {
		axes.push('for-rask');
	}
	if (family === 'running' && d != null && d > 0 && (m ?? e) != null) axes.push('for-langsom');
	if ((MIN_DISTANCE_METERS_BY_FAMILY[family] != null && d != null && d > 0) || (e != null && e > 0))
		axes.push('for-kort');
	if ((e != null && m != null && e > 0 && m > 0) || (e != null && e > 0)) axes.push('for-lang');

	return axes;
}

export function triageReport(
	candidates: TriageCandidate[],
	options: TriageOptions = {}
): TriageReport {
	const byAxis = Object.fromEntries(AXES.map((a) => [a, 0])) as Record<TriageAxis, number>;
	const coverage = Object.fromEntries(AXES.map((a) => [a, 0])) as TriageCoverage;
	const flagged: TriageResult[] = [];

	for (const candidate of candidates) {
		for (const axis of judgeable(candidate, options)) coverage[axis] += 1;

		const findings = triageCandidate(candidate, options);
		if (findings.length === 0) continue;
		for (const f of findings) byAxis[f.axis] += 1;
		flagged.push({
			candidate,
			findings,
			worst: Math.max(...findings.map((f) => f.severity))
		});
	}

	flagged.sort((a, b) => b.worst - a.worst);

	return {
		flagged,
		checked: candidates.length,
		byAxis,
		coverage,
		paceReference: options.paceReference ?? null
	};
}
