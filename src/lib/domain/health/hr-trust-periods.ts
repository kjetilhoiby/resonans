/**
 * Hvilke PERIODER er pulsdata til å stole på?
 *
 * ## Hvorfor per periode, og ikke per økt
 *
 * `hr-artefacts.ts` dømmer én kurve av gangen, og det er riktig når en økt
 * analyseres. Men spørsmålet før en arkivimport er et annet: *hvilke år* kan vi
 * ta inn puls fra? Brukerens gamle brystbelte var ødelagt i en periode — det
 * hoppet 130 → 230 på ett sekund og sto fast der oppe — og å importere de årene
 * med puls ville lagt en hel epoke av rene kvalitetsminutter inn i grafen som
 * skal svare på om de rolige øktene er rolige.
 *
 * En dom per økt kan ikke svare på det uten å laste hvert spor. Denne modulen
 * svarer i to lag, og lagene har ULIKE nevnere — de skal derfor aldri summeres.
 *
 * ## Lag 1: skalarene, over hele historikken
 *
 * `avgHeartRate` og `maxHeartRate` ligger på `canonical_workouts` som tall. De
 * kan leses for ni år i én spørring, uten å røre et eneste spor.
 *
 * **Lag 1 finner bare det UMULIGE.** Et snitt kan per definisjon ikke overstige
 * maksimum, så `isCredibleAverageHr` er en hard grense. Men den har en kjent
 * blindsone: et belte låst på 200 gir et snitt rundt 190, som er mistenkelig og
 * fullt mulig. **«Ingen funn» i lag 1 er derfor ikke det samme som «ren».** Den
 * setningen er den viktigste i modulen, og `describeHrTrust` sier den høyt.
 *
 * ## Lag 2: et UTVALG av kurver
 *
 * Blindsonen lukkes bare av blokkstrukturen, altså av punktene. Å laste hvert
 * spor i ni år er ikke aktuelt (de er tunge, og det var grunnen til markøren i
 * reanalyse-jobben), så lag 2 er et utvalg: noen få kurver per periode, spredt
 * utover perioden framfor tatt fra starten.
 *
 * Et utvalg som ser rent ut BEVISER ingenting, og feltnavnene sier at det er et
 * utvalg. Et utvalg som ser ødelagt ut er derimot nok: finner vi to fastlåste
 * kurver i 2014, er ikke spørsmålet lenger om det året har et problem.
 */

import { osloDayKey } from '../oslo-time';
import { isCredibleAverageHr, MAX_PLAUSIBLE_HR, type HrRejectionReason } from './hr-artefacts';

/**
 * Hvor mange økter MED puls en periode må ha før vi setter en merkelapp.
 *
 * Under dette rapporteres tallene uten dom, som i `describeWeeklyIntensity`: en
 * merkelapp på to økter er en gjetning med selvtillit.
 */
export const MIN_SESSIONS_FOR_VERDICT = 5;

/**
 * Andelen umulige økter som skiller et enkeltavvik fra en ødelagt sensor.
 *
 * En tiendedel av periodens økter med et umulig snitt er ikke uflaks — det er
 * utstyret. Under det kan én økt med et rart tall være en glipp i én
 * registrering, og da skal ikke hele året stemples.
 */
export const WIDESPREAD_SHARE = 0.1;

/**
 * Hvor mange kurver utvalget må ha før et FLERTALL betyr noe.
 *
 * Uten dette kravet var «én forkastet av to hentede» et flertall, og et helt år
 * ble stemplet «utbredt» av én kurve. Samme feil som enhver terskel gjør ved
 * n = 2 — og `MIN_SESSIONS_FOR_VERDICT` finnes for nøyaktig samme grunn på
 * skalarsiden.
 */
export const MIN_CURVE_SAMPLE_FOR_VERDICT = 3;

/** Merkelappen er gradert, aldri binær — «til å stole på» er ikke et ja/nei. */
export type HrTrustSeverity = 'ren' | 'enkeltavvik' | 'utbredt' | 'for-lite-data';

export interface HrTrustSession {
	startTime: Date;
	avgHr: number | null;
	maxHr: number | null;
}

/** Utfallet av en kurvediagnose, slik lag 2 leverer den per periode. */
export interface HrTrustCurveSample {
	/** Perioden kurven hører til, samme nøkkel som lag 1 bruker. */
	period: string;
	usable: boolean;
	reasons: HrRejectionReason[];
}

export interface HrTrustPeriod {
	/** Oslo-året, som streng. */
	period: string;
	sessions: number;
	/** Økter som i det hele tatt har et pulstall. */
	withHr: number;
	/** Økter med et snitt som ikke kan være en puls. */
	suspectAvg: number;
	/** Økter med en makspuls over det fysiologisk mulige. */
	suspectMax: number;
	/** Unionen — en økt kan feile på begge, og skal telles én gang. */
	suspect: number;
	suspectShare: number;
	/** Høyeste og laveste snittpuls i perioden, som kontekst til tallene. */
	avgHrRange: { min: number; max: number } | null;
	/** Høyeste registrerte makspuls. Det er tallet som avslører et belte. */
	peakHr: number | null;
	/**
	 * Lag 2, med SIN EGEN nevner: `curvesSampled` er ikke `sessions`, og
	 * `curvesRejected` skal derfor aldri legges til `suspect`.
	 */
	curvesSampled: number;
	curvesRejected: number;
	curveReasons: Partial<Record<HrRejectionReason, number>>;
	severity: HrTrustSeverity;
}

/**
 * Grupperer øktene per Oslo-år og teller det umulige.
 *
 * **Året leses av Oslo-DATOSTRENGEN**, ikke av `getFullYear()`: serverens lokale
 * tid er UTC i drift, så en økt 31. desember kl. 23:30 Oslo ville havnet i året
 * etter. Samme grunn som `mondayOf` i `weekly-intensity.ts`.
 */
export function buildHrTrustPeriods(
	sessions: HrTrustSession[],
	baseline: { restHr: number; maxHr: number },
	curves: HrTrustCurveSample[] = []
): HrTrustPeriod[] {
	const byPeriod = new Map<string, HrTrustPeriod>();

	const ensure = (period: string): HrTrustPeriod => {
		const existing = byPeriod.get(period);
		if (existing) return existing;
		const fresh: HrTrustPeriod = {
			period,
			sessions: 0,
			withHr: 0,
			suspectAvg: 0,
			suspectMax: 0,
			suspect: 0,
			suspectShare: 0,
			avgHrRange: null,
			peakHr: null,
			curvesSampled: 0,
			curvesRejected: 0,
			curveReasons: {},
			severity: 'for-lite-data'
		};
		byPeriod.set(period, fresh);
		return fresh;
	};

	for (const session of sessions) {
		const period = osloDayKey(session.startTime).slice(0, 4);
		const bucket = ensure(period);
		bucket.sessions += 1;

		const avg = typeof session.avgHr === 'number' && session.avgHr > 0 ? session.avgHr : null;
		const max = typeof session.maxHr === 'number' && session.maxHr > 0 ? session.maxHr : null;
		if (avg === null && max === null) continue;
		bucket.withHr += 1;

		if (avg !== null) {
			bucket.avgHrRange = bucket.avgHrRange
				? { min: Math.min(bucket.avgHrRange.min, avg), max: Math.max(bucket.avgHrRange.max, avg) }
				: { min: avg, max: avg };
		}
		if (max !== null) {
			bucket.peakHr = bucket.peakHr === null ? max : Math.max(bucket.peakHr, max);
		}

		const badAvg = avg !== null && !isCredibleAverageHr(avg, baseline);
		const badMax = max !== null && max > MAX_PLAUSIBLE_HR;
		if (badAvg) bucket.suspectAvg += 1;
		if (badMax) bucket.suspectMax += 1;
		// Unionen, ikke summen: en økt som feiler på begge er én økt.
		if (badAvg || badMax) bucket.suspect += 1;
	}

	for (const curve of curves) {
		const bucket = ensure(curve.period);
		bucket.curvesSampled += 1;
		if (curve.usable) continue;
		bucket.curvesRejected += 1;
		for (const reason of curve.reasons) {
			bucket.curveReasons[reason] = (bucket.curveReasons[reason] ?? 0) + 1;
		}
	}

	const periods = [...byPeriod.values()];
	for (const bucket of periods) {
		bucket.suspectShare = bucket.withHr > 0 ? round4(bucket.suspect / bucket.withHr) : 0;
		bucket.severity = severityFor(bucket);
	}
	return periods.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Merkelappen settes av LAG 1 alene, med vilje.
 *
 * Lag 2 har en annen nevner — noen få kurver mot alle øktene — og å blande dem
 * ville laget et forholdstall av to ulike grunnlag. Det er nettopp feilen
 * `hrRejected` i reanalyse-jobben ble delt opp for å unngå. Men et forkastet
 * utvalg kan ikke ignoreres: én ødelagt kurve er et FUNN, uansett hva skalarene
 * sa, så den løfter en «ren» periode til «enkeltavvik» og et flertall til
 * «utbredt».
 */
function severityFor(bucket: HrTrustPeriod): HrTrustSeverity {
	// Merkelappen måler UTBREDELSE, ikke alvor. Et enkeltfunn er et enkeltfunn
	// uansett hvor stygt det er — `curveReasons` sier hva slags, og `pinned` er
	// synlig der. Å la ett funn bety «utbredt» ville gjort ordet ubrukelig.
	const curvesMajorityBad =
		bucket.curvesSampled >= MIN_CURVE_SAMPLE_FOR_VERDICT &&
		bucket.curvesRejected * 2 >= bucket.curvesSampled;

	if (bucket.suspectShare >= WIDESPREAD_SHARE || curvesMajorityBad) return 'utbredt';
	// Et konkret funn i et spor er et funn, også i en periode som er for tynn til
	// at skalarene kan dømme.
	if (bucket.suspect > 0 || bucket.curvesRejected > 0) return 'enkeltavvik';
	if (bucket.withHr < MIN_SESSIONS_FOR_VERDICT) return 'for-lite-data';
	return 'ren';
}

/**
 * Setningene om periodene. Bor i domenelaget fordi de bærer forbeholdene.
 *
 * Rekkefølgen er bevisst: hva vi fant først, forbeholdet sist. Uten
 * blindsone-setningen leser «ingen funn» som en garanti, og det er nettopp den
 * garantien lag 1 ikke kan gi.
 */
export function describeHrTrust(periods: HrTrustPeriod[]): string[] {
	if (periods.length === 0) return ['Ingen økter å vurdere.'];

	const lines: string[] = [];
	const broken = periods.filter((p) => p.severity === 'utbredt');
	const spotty = periods.filter((p) => p.severity === 'enkeltavvik');
	const clean = periods.filter((p) => p.severity === 'ren');
	const thin = periods.filter((p) => p.severity === 'for-lite-data');

	if (broken.length > 0) {
		lines.push(
			`Puls fra ${listPeriods(broken)} bør ikke importeres: ${broken
				.map((p) => `${p.period} har ${p.suspect} av ${p.withHr} økter med tall som ikke kan være en puls${p.peakHr ? ` (høyeste ${p.peakHr})` : ''}`)
				.join('; ')}.`
		);
	}
	if (spotty.length > 0) {
		lines.push(
			`${listPeriods(spotty)} har enkeltavvik — nok til å se på øktene, ikke nok til å forkaste året.`
		);
	}
	if (clean.length > 0) {
		lines.push(`Ingen umulige tall i ${listPeriods(clean)}.`);
	}
	if (thin.length > 0) {
		lines.push(
			`${listPeriods(thin)} har under ${MIN_SESSIONS_FOR_VERDICT} økter med puls — for lite å dømme på.`
		);
	}

	const sampled = periods.reduce((sum, p) => sum + p.curvesSampled, 0);
	if (sampled > 0) {
		const rejected = periods.reduce((sum, p) => sum + p.curvesRejected, 0);
		lines.push(
			rejected > 0
				? `Av ${sampled} kurver i utvalget ble ${rejected} forkastet. Utvalget er noen få økter per periode, så tallet er et funn — ikke en andel.`
				: `${sampled} kurver i utvalget var brukbare. Utvalget er noen få økter per periode og beviser ikke at resten er det.`
		);
	}

	// Forbeholdet, alltid sist og alltid med.
	lines.push(
		'Skalarene fanger bare det umulige. Et belte som låser seg på 200 gir et snitt som er mistenkelig og fullt mulig, så «ingen funn» betyr ikke «ren» — det betyr at snitt og makspuls ikke avslørte noe.'
	);
	return lines;
}

function listPeriods(periods: HrTrustPeriod[]): string {
	const names = periods.map((p) => p.period);
	if (names.length === 1) return names[0];
	return `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;
}

function round4(n: number): number {
	return Math.round(n * 10_000) / 10_000;
}
