/**
 * Bevegelsestid fra et GPS-spor.
 *
 * Bakgrunnen: `parseWorkoutFile` regner varighet som `siste punkt − første punkt`,
 * altså *elapsed*. Glemmer man å avslutte sporingen, blir den døde halen med. En
 * el-sykkeltur på 9,07 km ble stående som 2 t 20 min, og siden MET-stien i
 * `effort-model.ts` er rent lineær i varighet ga det effort 114 der svaret var ~20.
 * Samme tall priser dagens aktivitetsforbruk i `energy-expenditure.ts`, så ett
 * felt forurenset både ukas effort, akutt/kronisk og energibalansen.
 *
 * Strava løser dette ved å regne bevegelsestid, og gjør det automatisk. Denne
 * modulen gjør det samme: sporet finnes allerede i `sensor_events.data.trackPoints`,
 * så tallet kan utledes uten at brukeren gjør noe — også for historikken.
 *
 * Modulen er ren (ingen DB, ingen I/O), så både parse-stien, backfillen og
 * enhetstestene kan bruke den.
 */

import { classifyEffortFamily, type EffortFamily } from './effort-model';

export interface MovingTimePoint {
	lat?: number | null;
	lon?: number | null;
	time?: string | null;
}

export interface MovingTimeResult {
	/** Sekunder der forflytningen lå over terskelen for sportsfamilien. */
	movingSeconds: number;
	/** `siste punkt − første punkt`, samme tall som `data.duration`. */
	elapsedSeconds: number;
	/** Sekunder i ro. `moving + stopped` er som regel < elapsed — se `coverage`. */
	stoppedSeconds: number;
	/**
	 * Andel av elapsed som er dekket av vurderte intervaller (0..1). Under
	 * `MIN_COVERAGE` returnerer modulen null i stedet for et tall — et spor med
	 * store hull kan ikke si hvor lenge noen sto stille.
	 */
	coverage: number;
	family: EffortFamily;
	thresholdMetersPerSecond: number;
	/** Median sekunder mellom gyldige sporpunkter. Se `MAX_MEDIAN_SAMPLE_SECONDS`. */
	medianSampleSeconds: number;
	/** `siste − første` gyldige punkt. Kan være langt kortere enn økta — se `MIN_TRACK_SPAN_SHARE`. */
	trackSpanSeconds: number;
}

/** Hvorfor et spor ikke fikk et svar. Rapporteres, ikke svelget. */
export type MovingTimeRejection =
	| 'family_uten_bevegelsestid'
	| 'for_faa_punkter'
	| 'for_tynt_spor'
	| 'sporet_dekker_ikke_okta'
	| 'for_daarlig_dekning'
	| 'ingen_varighet';

export interface MovingTimeAnalysis {
	result: MovingTimeResult | null;
	rejection: MovingTimeRejection | null;
	/** Fylt ut også når svaret ble avvist — det er tallene som forklarer hvorfor. */
	medianSampleSeconds: number | null;
	trackSpanSeconds: number | null;
	pointCount: number;
}

/**
 * Terskler i m/s, per effort-family.
 *
 * De ligger godt over «i det hele tatt i bevegelse». GPS-punkter spriker 2–5
 * meter når man står stille, og en terskel på 0,5 m/s ville derfor kreditert
 * stillstand som bevegelse — nøyaktig det vi prøver å bli kvitt.
 *
 * **Sykkelterskelen er 2,5 og ikke Stravas ~1,4 med vilje.** Halen på en tur er
 * sjelden bare stillstand: man parkerer, tar telefonen med og går inn. Gange
 * ligger på 1,2–1,7 m/s og ville bestått en terskel på 1,4 — mens ekte sykling
 * ligger på 4–8. Gapet er så stort at porten kan settes der uten å tape noe
 * reelt, og en kryping bak fotgjengere som faller utenfor er sekunder, ikke
 * minutter.
 *
 * **Løping har ikke det gapet, og terskelen later ikke som.** En rask gange
 * (1,7) og en sliten jogg (1,8) er ikke til å skille på fart alene, så
 * `running` står på 0,7 — en løpetur med gangpauser krediteres, og en gåtur
 * hjem etterpå gjør det også. Det er en kjent rest, ikke et løst problem.
 */
export const MOVING_THRESHOLD_MS_BY_FAMILY: Record<EffortFamily, number> = {
	running: 0.7,
	cycling: 2.5,
	ebike: 2.5,
	walking: 0.25,
	hiking: 0.25,
	swimming: 0,
	strength: 0,
	yoga: 0,
	other: 0.5
};

/**
 * Farten vurderes over et vindu på minst dette, ikke mellom to nabopunkter.
 * Ekko sampler hvert 1–4 sekund, og over så kort tid er GPS-støyen på samme
 * størrelsesorden som en faktisk forflytning.
 */
export const SPEED_WINDOW_SECONDS = 10;

/**
 * Det grove vinduet: «kom jeg noen vei?».
 *
 * Ti sekunder holder mot jitter fra en telefon som ligger i ro, men **ikke** mot
 * GPS innendørs. Parkerer man i en garasje og tar telefonen med opp på kontoret,
 * er halen ikke stillstand — det er multipath som kaster posisjonen titalls meter
 * av gårde, og over ti sekunder ser det ut som fart. Feilen er en helt annen
 * størrelsesorden enn de 2–5 meterne et spor utendørs spriker.
 *
 * Over to minutter avslører den seg: en telefon i en garasje kommer ingen vei,
 * uansett hvor mye posisjonen hopper. Ekte sykling gjør det.
 */
export const PROGRESS_WINDOW_SECONDS = 120;

/**
 * Hvor stor del av familiens terskel det grove vinduet må nå. Andel framfor et
 * fast tall, så gulvet skalerer med sporten: 0,35 m/s for sykkel, 0,1 for gange.
 *
 * Lavt med vilje — porten skal fange «kommer ingen vei», ikke dømme tempo. Et
 * rødlys midt i en tur består den grove porten (vinduet rundt inneholder
 * syklingen på begge sider) og felles av den fine, som er riktig arbeidsdeling.
 */
export const PROGRESS_FLOOR_FRACTION = 0.25;

/**
 * Et intervall krediteres høyst så mange sekunder. Er det et hull i sporet —
 * tunnel, appen ble drept, opptaket ble pauset — vet vi ikke hva som skjedde i
 * hullet, og skal verken kreditere det som bevegelse eller som stillstand.
 */
export const MAX_CREDITED_INTERVAL_SECONDS = 60;

/**
 * Under denne dekningen sier vi ikke noe. Hevet fra 0,5 etter første måling mot
 * prod: et spor der halvparten av tida ikke er vurdert, kan ikke si hvor mye av
 * den som var stillstand.
 */
export const MIN_COVERAGE = 0.7;

/**
 * Maks median-avstand mellom sporpunkter, i sekunder.
 *
 * **Dette er porten som manglet, og fraværet ga selvsikkert tull.** Første
 * måling mot prod ga «56 min opptak → 8 min i bevegelse» på en løpetur. Hver
 * eneste verdi i rapporten var et helt antall minutter, som avslørte hva som
 * skjedde: sporene har punkter et minutt eller mer fra hverandre, og
 * `MAX_CREDITED_INTERVAL_SECONDS` kappet derfor *hvert* intervall til 60
 * sekunder. Bevegelsestiden ble antall krediterte intervaller × ett minutt —
 * et tall om sporets oppløsning, ikke om økta.
 *
 * På et spor med minuttavstand kan en pause ikke skilles fra et hull uansett
 * hvor god resten av modellen er. Da er «vet ikke» det eneste ærlige svaret.
 */
export const MAX_MEDIAN_SAMPLE_SECONDS = 15;

/**
 * Hvor stor del av øktas oppgitte varighet sporet må spenne over.
 *
 * **Dette er porten den virkelige feilen slapp gjennom.** Løpeturen 24. mars er
 * 8,33 km på 56 minutter ifølge både Withings og GPX-fila — men sporpunktene med
 * brukbar tid dekker bare 1,25 km og 7,5 minutter av den (splits og pulsfordeling
 * på flaten regnes fra de samme punktene og viser det svart på hvitt). Sporingen
 * gikk i stykker underveis. Modulen så et internt konsistent spor på sju
 * minutter, fant at alt var bevegelse, og svarte «8 min» på en 56-minutters økt.
 *
 * `coverage` fanget det ikke, fordi den måler krediterte intervaller mot
 * *sporets* eget spenn — ikke mot økta. Et spor kan være perfekt tett og likevel
 * beskrive en åttendedel av turen.
 *
 * Om de resterende 48 minuttene var bevegelse eller stillstand vet vi ingenting
 * om, og da er «vet ikke» det eneste svaret.
 */
export const MIN_TRACK_SPAN_SHARE = 0.8;

/** Færre punkter enn dette gir ingen mening å vurdere. */
export const MIN_POINTS = 10;

/**
 * Familier der bevegelsestid ikke er et meningsfullt begrep: styrke og yoga står
 * i ro med vilje, og bassengsvømming har ingen brukbar GPS. Terskelen deres er 0,
 * så vakten under er egentlig dobbel — den står her for å si hvorfor.
 */
const FAMILIES_WITHOUT_MOVING_TIME: ReadonlySet<EffortFamily> = new Set([
	'strength',
	'swimming',
	'yoga'
]);

const EARTH_RADIUS_METERS = 6371000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface ValidPoint {
	lat: number;
	lon: number;
	tSec: number;
	/** Absolutt tid — forslaget må kunne peke på et klokkeslett, ikke et offset. */
	tMs: number;
}

function validPoints(points: readonly MovingTimePoint[]): ValidPoint[] {
	const valid: Array<{ lat: number; lon: number; tMs: number }> = [];
	for (const point of points) {
		if (typeof point.lat !== 'number' || !Number.isFinite(point.lat)) continue;
		if (typeof point.lon !== 'number' || !Number.isFinite(point.lon)) continue;
		if (!point.time) continue;
		const tMs = Date.parse(point.time);
		if (!Number.isFinite(tMs)) continue;
		valid.push({ lat: point.lat, lon: point.lon, tMs });
	}
	valid.sort((a, b) => a.tMs - b.tMs);
	if (valid.length === 0) return [];
	const t0 = valid[0].tMs;
	return valid.map((p) => ({ lat: p.lat, lon: p.lon, tSec: (p.tMs - t0) / 1000, tMs: p.tMs }));
}

/**
 * Farten rundt intervallet [i-1, i], målt som **forflytning** mellom vinduets
 * endepunkter delt på tiden — ikke som sporlengden gjennom vinduet.
 *
 * Det er forskjellen som gjør terskelen til å stole på: sporlengde summerer
 * GPS-støyen (hvert lille hopp legger til meter), mens forflytning mellom to
 * punkter et stykke fra hverandre er ~0 når man ikke kommer noen vei, uansett
 * hvor mye punktene imellom spriker.
 */
function windowSpeed(points: readonly ValidPoint[], index: number, windowSeconds: number): number | null {
	let lo = index - 1;
	let hi = index;
	while (points[hi].tSec - points[lo].tSec < windowSeconds && (lo > 0 || hi < points.length - 1)) {
		// Utvid symmetrisk der det er rom, så vinduet ikke blir skjevt i endene.
		if (lo > 0 && (hi === points.length - 1 || index - lo <= hi - index)) lo -= 1;
		else if (hi < points.length - 1) hi += 1;
		else break;
	}
	const span = points[hi].tSec - points[lo].tSec;
	if (span <= 0) return null;
	const displacement = haversineMeters(points[lo].lat, points[lo].lon, points[hi].lat, points[hi].lon);
	return displacement / span;
}

export interface ComputeMovingTimeOptions {
	sportType?: string | null;
	sportFamily?: string | null;
	/**
	 * Øktas oppgitte varighet (`data.duration`), når den er kjent. Uten den kan
	 * modulen ikke se at sporet bare dekker en del av økta — se
	 * `MIN_TRACK_SPAN_SHARE`. Utelates den, hopper porten over.
	 */
	declaredDurationSeconds?: number | null;
}

/** Median sekunder mellom påfølgende punkter. */
function medianSampleSeconds(points: readonly ValidPoint[]): number | null {
	if (points.length < 2) return null;
	const gaps: number[] = [];
	for (let i = 1; i < points.length; i += 1) {
		const dt = points[i].tSec - points[i - 1].tSec;
		if (dt > 0) gaps.push(dt);
	}
	if (gaps.length === 0) return null;
	gaps.sort((a, b) => a - b);
	const mid = Math.floor(gaps.length / 2);
	return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

/**
 * Bevegelsestid for et spor, med grunnen når svaret ble avvist.
 *
 * Grunnen rapporteres framfor å svelges: en stille null ser ut som «ingen data»,
 * og da leter man etter feil i innhentingen i stedet for i sporets oppløsning.
 */
export function analyzeMovingTime(
	points: readonly MovingTimePoint[],
	options: ComputeMovingTimeOptions = {}
): MovingTimeAnalysis {
	const family = classifyEffortFamily(options.sportType ?? null, options.sportFamily ?? null);
	const valid = validPoints(points);
	const median = medianSampleSeconds(valid);
	const base = {
		result: null,
		medianSampleSeconds: median,
		trackSpanSeconds: valid.length > 0 ? valid[valid.length - 1].tSec : null,
		pointCount: valid.length
	};

	if (FAMILIES_WITHOUT_MOVING_TIME.has(family)) {
		return { ...base, rejection: 'family_uten_bevegelsestid' };
	}
	const threshold = MOVING_THRESHOLD_MS_BY_FAMILY[family];
	if (!(threshold > 0)) return { ...base, rejection: 'family_uten_bevegelsestid' };

	if (valid.length < MIN_POINTS) return { ...base, rejection: 'for_faa_punkter' };

	// Tetthetsporten står FØR alt annet som regner: er sporet for tynt, er
	// tallene under bare en beskrivelse av oppløsningen.
	if (median === null || median > MAX_MEDIAN_SAMPLE_SECONDS) {
		return { ...base, rejection: 'for_tynt_spor' };
	}

	const elapsedSeconds = valid[valid.length - 1].tSec;
	if (!(elapsedSeconds > 0)) return { ...base, rejection: 'ingen_varighet' };

	// Sporet må dekke økta, ikke bare være internt konsistent.
	const declared = options.declaredDurationSeconds;
	if (typeof declared === 'number' && declared > 0 && elapsedSeconds / declared < MIN_TRACK_SPAN_SHARE) {
		return { ...base, rejection: 'sporet_dekker_ikke_okta' };
	}

	const progressFloor = threshold * PROGRESS_FLOOR_FRACTION;

	let movingSeconds = 0;
	let stoppedSeconds = 0;
	for (let i = 1; i < valid.length; i += 1) {
		const dt = valid[i].tSec - valid[i - 1].tSec;
		if (!(dt > 0)) continue;
		const credited = Math.min(dt, MAX_CREDITED_INTERVAL_SECONDS);
		const speed = windowSpeed(valid, i, SPEED_WINDOW_SECONDS);
		if (speed === null) continue;
		// To porter, og begge må åpne. Den fine spør «var jeg i bevegelse nå»,
		// den grove «kom jeg noen vei». Innendørs GPS-drift består den fine og
		// felles av den grove; et rødlys er motsatt.
		const progress = windowSpeed(valid, i, PROGRESS_WINDOW_SECONDS);
		const moving = speed >= threshold && (progress === null || progress >= progressFloor);
		if (moving) movingSeconds += credited;
		else stoppedSeconds += credited;
	}

	const coverage = (movingSeconds + stoppedSeconds) / elapsedSeconds;
	if (coverage < MIN_COVERAGE) return { ...base, rejection: 'for_daarlig_dekning' };

	return {
		result: {
			// Bevegelsestid kan aldri overstige elapsed, uansett hvordan intervallene faller.
			movingSeconds: Math.round(Math.min(movingSeconds, elapsedSeconds)),
			elapsedSeconds: Math.round(elapsedSeconds),
			stoppedSeconds: Math.round(stoppedSeconds),
			coverage: Math.round(coverage * 1000) / 1000,
			family,
			thresholdMetersPerSecond: threshold,
			medianSampleSeconds: Math.round(median * 10) / 10,
			trackSpanSeconds: Math.round(elapsedSeconds)
		},
		rejection: null,
		medianSampleSeconds: median,
		trackSpanSeconds: elapsedSeconds,
		pointCount: valid.length
	};
}

/**
 * Bevegelsestid for et spor, eller null når sporet ikke bærer svaret.
 *
 * Null betyr «vet ikke» og skal føre til at elapsed brukes videre — ikke til at
 * økta nulles ut.
 */
export function computeMovingTime(
	points: readonly MovingTimePoint[],
	options: ComputeMovingTimeOptions = {}
): MovingTimeResult | null {
	return analyzeMovingTime(points, options).result;
}

/**
 * Andelen av økta som var stillstand, 0..1. Brukes til å avgjøre om det er verdt
 * å si noe til brukeren — en tur med 4 % rødlys er ikke en historie, en tur med
 * 80 % død hale er det.
 */
export function stoppedShare(result: MovingTimeResult): number {
	if (!(result.elapsedSeconds > 0)) return 0;
	return Math.max(0, Math.min(1, 1 - result.movingSeconds / result.elapsedSeconds));
}

/**
 * Terskelen for at avviket er verdt å nevne på flaten. 20 % av en times økt er
 * tolv minutter — nok til å flytte effort merkbart.
 */
export const NOTABLE_STOPPED_SHARE = 0.2;

/**
 * Et forslag om at sporingen ble glemt — aldri en korreksjon.
 *
 * ## Hvorfor forslag og ikke automatikk
 *
 * Første utgave rettet dette automatisk for alle økter. Den endret 96 økter for
 * en feil som skjer et par ganger i året, og tok feil på de fleste av dem: en
 * 56-minutters løpetur ble til «8 min» fordi sporingen hadde brutt sammen
 * underveis, en fjelltur mistet halvparten fordi bratt terreng er sakte. Ingen
 * av de radene var en glemt sporing.
 *
 * Retningen er nå motsatt. Vi rører ingenting; vi sier fra når det ser ut som
 * du glemte å stoppe, og du bestemmer. En feil gjetning koster da et forslag du
 * avviser, ikke et tall du må oppdage.
 */
export interface ForgottenTrackingSuggestion {
	/** Siste punkt der du faktisk var i bevegelse — der ruta stopper. */
	cutAtIso: string;
	/** Varigheten økta ville fått. */
	keptSeconds: number;
	/** Hva som kuttes bort. */
	droppedSeconds: number;
	droppedShare: number;
	family: EffortFamily;
}

/**
 * Minste hale verdt å foreslå. En glemt sporing er timer, ikke minutter — og et
 * forslag som dukker opp på hver tur blir bakgrunnsstøy, og bakgrunnsstøy blir
 * slått av. Samme resonnement som `sendFuelNudge` sin én-per-dag-gate.
 */
export const MIN_SUGGESTED_TRIM_SECONDS = 10 * 60;

/** …og den må være en merkbar del av økta, ikke ti minutter av en femtimers tur. */
export const MIN_SUGGESTED_TRIM_SHARE = 0.15;

/** Vinduet «var jeg vedvarende i bevegelse her?» måles over. */
export const SUSTAINED_WINDOW_SECONDS = 60;

/** …og hvor stor del av det vinduet som må være bevegelse. */
export const SUSTAINED_MOVING_SHARE = 0.5;

/**
 * Finner halen der sporet slutter å komme noen vei, og foreslår å snappe
 * sluttpunktet dit.
 *
 * Returnerer null når det ikke er noe å foreslå — som er det vanlige svaret.
 * Bruker samme to porter som `analyzeMovingTime`, så «i bevegelse» betyr det
 * samme her som der.
 */
export function suggestForgottenTracking(
	points: readonly MovingTimePoint[],
	options: ComputeMovingTimeOptions = {}
): ForgottenTrackingSuggestion | null {
	const family = classifyEffortFamily(options.sportType ?? null, options.sportFamily ?? null);
	if (FAMILIES_WITHOUT_MOVING_TIME.has(family)) return null;
	const threshold = MOVING_THRESHOLD_MS_BY_FAMILY[family];
	if (!(threshold > 0)) return null;

	const valid = validPoints(points);
	if (valid.length < MIN_POINTS) return null;

	const median = medianSampleSeconds(valid);
	if (median === null || median > MAX_MEDIAN_SAMPLE_SECONDS) return null;

	const totalSeconds = valid[valid.length - 1].tSec;
	if (!(totalSeconds > 0)) return null;

	const progressFloor = threshold * PROGRESS_FLOOR_FRACTION;

	// Klassifiser hvert intervall, og bygg en kumulativ sum av bevegelsessekunder.
	const cumulativeMoving = new Array<number>(valid.length).fill(0);
	for (let i = 1; i < valid.length; i += 1) {
		const dt = valid[i].tSec - valid[i - 1].tSec;
		let moving = false;
		if (dt > 0) {
			const speed = windowSpeed(valid, i, SPEED_WINDOW_SECONDS);
			const progress = windowSpeed(valid, i, PROGRESS_WINDOW_SECONDS);
			moving = speed !== null && speed >= threshold && (progress === null || progress >= progressFloor);
		}
		cumulativeMoving[i] = cumulativeMoving[i - 1] + (moving ? Math.min(dt, MAX_CREDITED_INTERVAL_SECONDS) : 0);
	}

	/**
	 * Siste punkt med VEDVARENDE bevegelse — ikke siste enkeltintervall som besto
	 * portene.
	 *
	 * Forskjellen er ikke akademisk. I en garasje kaster multipath posisjonen
	 * titalls meter, og et enkelt tisekundersvindu kan da vise 4 m/s. Ligger
	 * gåturen inn på kontoret rett etterpå, består den grove porten også — den
	 * kommer jo faktisk noen vei — og kuttet ville landet nede i garasjen med et
	 * par minutter fjernet i stedet for halvannen time.
	 *
	 * Kravet er derfor at over halve det siste minuttet før punktet var bevegelse.
	 */
	let lastMovingIndex = -1;
	for (let i = valid.length - 1; i >= 1; i -= 1) {
		let j = i;
		while (j > 0 && valid[i].tSec - valid[j].tSec < SUSTAINED_WINDOW_SECONDS) j -= 1;
		const span = valid[i].tSec - valid[j].tSec;
		if (span <= 0) continue;
		const movingInWindow = cumulativeMoving[i] - cumulativeMoving[j];
		if (movingInWindow / span >= SUSTAINED_MOVING_SHARE) {
			lastMovingIndex = i;
			break;
		}
	}
	// Ingen vedvarende bevegelse i det hele tatt er ikke en glemt hale — det er en
	// økt vi ikke forstår, og da sier vi ingenting.
	if (lastMovingIndex < 1) return null;

	const keptSeconds = Math.round(valid[lastMovingIndex].tSec);
	const droppedSeconds = Math.round(totalSeconds - valid[lastMovingIndex].tSec);
	if (droppedSeconds < MIN_SUGGESTED_TRIM_SECONDS) return null;
	if (droppedSeconds / totalSeconds < MIN_SUGGESTED_TRIM_SHARE) return null;

	return {
		cutAtIso: new Date(valid[lastMovingIndex].tMs).toISOString(),
		keptSeconds,
		droppedSeconds,
		droppedShare: Math.round((droppedSeconds / totalSeconds) * 1000) / 1000,
		family
	};
}
