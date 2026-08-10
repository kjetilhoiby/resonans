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
	walking: 0.4,
	hiking: 0.4,
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

/** Under denne dekningen sier vi ikke noe. */
export const MIN_COVERAGE = 0.5;

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
	return valid.map((p) => ({ lat: p.lat, lon: p.lon, tSec: (p.tMs - t0) / 1000 }));
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
}

/**
 * Bevegelsestid for et spor, eller null når sporet ikke bærer svaret.
 *
 * Null betyr «vet ikke» og skal føre til at elapsed brukes videre — ikke til at
 * økta nulles ut. Grunnene til null er: for få punkter, for dårlig dekning, en
 * sportsfamilie der begrepet ikke gir mening (styrke, svømming i basseng), eller
 * en familie uten terskel.
 */
export function computeMovingTime(
	points: readonly MovingTimePoint[],
	options: ComputeMovingTimeOptions = {}
): MovingTimeResult | null {
	const family = classifyEffortFamily(options.sportType ?? null, options.sportFamily ?? null);
	if (FAMILIES_WITHOUT_MOVING_TIME.has(family)) return null;

	const threshold = MOVING_THRESHOLD_MS_BY_FAMILY[family];
	if (!(threshold > 0)) return null;

	const valid = validPoints(points);
	if (valid.length < MIN_POINTS) return null;

	const elapsedSeconds = valid[valid.length - 1].tSec;
	if (!(elapsedSeconds > 0)) return null;

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
	if (coverage < MIN_COVERAGE) return null;

	return {
		// Bevegelsestid kan aldri overstige elapsed, uansett hvordan intervallene faller.
		movingSeconds: Math.round(Math.min(movingSeconds, elapsedSeconds)),
		elapsedSeconds: Math.round(elapsedSeconds),
		stoppedSeconds: Math.round(stoppedSeconds),
		coverage: Math.round(coverage * 1000) / 1000,
		family,
		thresholdMetersPerSecond: threshold
	};
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
