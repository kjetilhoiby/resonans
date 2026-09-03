/**
 * Er pulskurven til å stole på i det hele tatt?
 *
 * ## Hvorfor modulen finnes
 *
 * Et brystbelte som mister kontakten hopper — målt på denne brukerens gamle
 * belte: 130 → 230 på ett sekund — og står deretter fast der oppe resten av
 * økta. Ingenting nedstrøms så det. `computeHrZoneDistribution` og
 * `computeIntensitySplit` godtok enhver `hr > 0`, så en økt låst på 230 kom ut
 * som **100 % Z5** og som **hele økta i kvalitetsminutter** — én sammenhengende
 * blokk over Z4s gulv, altså null rolig og null grått.
 *
 * Effort er verre, fordi klampen skjuler feilen: `hrr` klemmes til [0, 1], så
 * `trimpPerMinute(1)` ≈ 4,36 per minutt gjør en økt på 45 minutter til ~196 der
 * en ekte rolig økt av samme lengde skårer ~45. Et tall fire ganger for høyt ser
 * ut som en hard økt, ikke som et avvik noen leter etter.
 *
 * ## Hvorfor MENGDE og ikke ett punkt
 *
 * Samme lærdom som `IntensitySplit`: en binær dom over ett grensetilfelle er
 * katastrofal, en mengde er det ikke. Én stray 220 i et spor på 2000 punkter er
 * 0,05 % og skal ikke koste økta pulskurven; et belte låst i 40 minutter er
 * ~90 % og skal. Derfor teller vi ANDELER og lengste fastlåste strekk, og feller
 * dommen på kurven som helhet.
 *
 * ## Vi forkaster, vi reparerer ikke
 *
 * Samme prinsipp som `suggestForgottenTracking`, men uten forslaget: «ingen
 * brukbar puls» er en tilstand systemet alt håndterer riktig — sone og
 * tidsdeling blir `undefined`, effort faller til MET. Å kaste enkeltpunkter og
 * beholde resten ville skjult at sensoren var ødelagt; å gjette en verdi ville
 * gjort en gjetning til en måling.
 */

import { MAX_HR_MAX } from './heart-rate-baseline';

/**
 * Øvre grense for en troverdig puls.
 *
 * Delt med `resolveMaxHr` med vilje: «over dette er tallet ikke en puls» er
 * samme påstand enten den gjelder en oppgitt makspuls eller en måling i et
 * spor, og et kalibreringstall får ikke finnes to steder.
 */
export const MAX_PLAUSIBLE_HR = MAX_HR_MAX;

/**
 * Nedre grense. `hr <= 0` filtreres alt bort som «ingen måling»; dette fanger de
 * positive tallene som likevel ikke er en puls under bevegelse.
 */
export const MIN_PLAUSIBLE_HR = 30;

/** Minste endring som i det hele tatt vurderes som et artefakthopp. */
export const ARTEFACT_MIN_JUMP_BPM = 25;

/**
 * Raskeste endring som fortsatt kan være fysiologi, i slag per sekund.
 *
 * Bevisst mer romslig enn `ARTEFACT_MAX_BPM_PER_SECOND` (2) i `hr-recovery.ts`:
 * der måles et 60-sekundersvindu rundt et kjent anker, og en falsk positiv
 * koster én måling. Her dømmes en hel økt, og en falsk positiv koster
 * pulskurven for økta. Starten på et hardt drag klarer ~1,5 slag/s; 130 → 230 på
 * ett sekund er 100.
 */
export const ARTEFACT_MAX_BPM_PER_SECOND = 3;

/**
 * Hvor stor andel av kurven som får være useriøs før hele kurven forkastes.
 *
 * To prosent er valgt for å slippe gjennom enkeltglipp og stoppe et mønster.
 */
export const MAX_ARTEFACT_SHARE = 0.02;

/** Hvor lite pulsen kan variere over et strekk og fortsatt kalles målt. */
export const PINNED_TOLERANCE_BPM = 1;

/**
 * Hvor lenge en nær konstant puls må vare før strekket regnes som fastlåst.
 *
 * **Fastlåst alene feller ingen økt, og det er en beslutning.** Fem minutter
 * innenfor ett slag er ikke fysiologi — pulsen vandrer med pusten og med
 * terrenget selv på tredemølle — men en enhet som glatter og rapporterer heltall
 * kan levere en flat serie likevel, og et nedsamplet spor kan gjøre det verre.
 * Prisen for en falsk positiv er hele øktas pulskurve.
 *
 * Derfor krever `pinned` et artefakthopp i samme kurve. Det er nettopp mønsteret
 * et belte som mister kontakten lager: et hopp, og så fast der oppe. Hver av de
 * to alene er tvetydig; sammen er de ikke det.
 *
 * Konsekvensen er kjent og akseptert: et belte som glir fast på en verdi UNDER
 * taket, uten et hopp, slipper gjennom. En vakt som spiser ekte økter mister
 * tilliten fortere enn en som slipper gjennom et sjeldent tilfelle.
 *
 * Kravet om flere punkter i strekket står ved siden av: to identiske målinger
 * med fem minutter mellom dem er et hull, ikke en fastlåst sensor.
 */
export const MIN_PINNED_SECONDS = 300;
export const MIN_PINNED_SAMPLES = 10;

/**
 * Hvor langt over full reserve en SNITTPULS kan ligge før den forkastes.
 *
 * Et snitt kan per definisjon ikke overstige maksimum, så alt over 1,0 er i
 * prinsippet umulig. Slingringsmonnet finnes fordi vår `maxHr` som regel er
 * Tanaka-anslaget og ikke en måling: med hvile 46 og maks 179 avvises snitt over
 * ~199, mens et mistenkelig men mulig snitt på 185 fortsatt får TRIMP.
 */
export const MAX_CREDIBLE_AVG_HRR = 1.15;

export type HrRejectionReason = 'implausible_values' | 'pinned' | 'noisy_jumps';

export interface HrSample {
	/** Sekunder fra start. Trenger ikke være jevnt fordelt. */
	tSec: number;
	hr: number;
}

export interface HrSeriesDiagnosis {
	/** Punkter med en positiv pulsverdi. */
	samples: number;
	/** Verdier utenfor det fysiologisk mulige. */
	implausible: number;
	implausibleShare: number;
	/** Intervaller der pulsen endret seg raskere enn fysiologi tillater. */
	jumps: number;
	jumpShare: number;
	/** Lengste strekk med nær konstant puls, i sekunder. */
	longestPinnedSeconds: number;
	/** Ytterpunktene, så en logglinje kan vise hva som faktisk skjedde. */
	maxHr: number | null;
	minHr: number | null;
	usable: boolean;
	reasons: HrRejectionReason[];
}

/**
 * Dømmer pulskurven som helhet.
 *
 * Alle tre detektorene måles alltid, og alle grunnene rapporteres. Et belte som
 * feiler treffer typisk to av dem, og da er det mer opplysende å se begge enn å
 * stoppe på den første.
 */
export function diagnoseHrSeries(samples: HrSample[]): HrSeriesDiagnosis {
	const usable = samples.filter(
		(s) => Number.isFinite(s.hr) && s.hr > 0 && Number.isFinite(s.tSec)
	);

	if (usable.length === 0) {
		return {
			samples: 0,
			implausible: 0,
			implausibleShare: 0,
			jumps: 0,
			jumpShare: 0,
			longestPinnedSeconds: 0,
			maxHr: null,
			minHr: null,
			// Ingen puls er ikke en ødelagt puls: den som spør faller tilbake på
			// «ingen måling», ikke på «sensoren løy». `reasons` er tom, og det er
			// forskjellen en flate skal kunne lese.
			usable: false,
			reasons: []
		};
	}

	let implausible = 0;
	let jumps = 0;
	let intervals = 0;
	let maxHr = -Infinity;
	let minHr = Infinity;

	let runStartSec = usable[0].tSec;
	let runMin = usable[0].hr;
	let runMax = usable[0].hr;
	let runSamples = 1;
	let longestPinnedSeconds = 0;

	const closePinnedRun = (endSec: number) => {
		const seconds = endSec - runStartSec;
		if (runSamples >= MIN_PINNED_SAMPLES && seconds > longestPinnedSeconds) {
			longestPinnedSeconds = seconds;
		}
	};

	for (let i = 0; i < usable.length; i += 1) {
		const { hr, tSec } = usable[i];
		if (hr > maxHr) maxHr = hr;
		if (hr < minHr) minHr = hr;
		if (hr > MAX_PLAUSIBLE_HR || hr < MIN_PLAUSIBLE_HR) implausible += 1;

		if (i === 0) continue;

		const prev = usable[i - 1];
		const dt = tSec - prev.tSec;
		if (dt > 0) {
			intervals += 1;
			const change = Math.abs(hr - prev.hr);
			if (change >= ARTEFACT_MIN_JUMP_BPM && change / dt > ARTEFACT_MAX_BPM_PER_SECOND) {
				jumps += 1;
			}
		}

		// Fastlåst strekk: utvid så lenge HELE strekket holder seg innenfor
		// toleransen. Sammenligningen går mot strekkets egne ytterpunkter, ikke mot
		// forrige punkt — ellers ville en langsom drift på ett slag av gangen sett
		// fastlåst ut i en hel time.
		const nextMin = Math.min(runMin, hr);
		const nextMax = Math.max(runMax, hr);
		if (nextMax - nextMin <= PINNED_TOLERANCE_BPM) {
			runMin = nextMin;
			runMax = nextMax;
			runSamples += 1;
		} else {
			closePinnedRun(prev.tSec);
			runStartSec = tSec;
			runMin = hr;
			runMax = hr;
			runSamples = 1;
		}
	}
	closePinnedRun(usable[usable.length - 1].tSec);

	const implausibleShare = implausible / usable.length;
	const jumpShare = intervals > 0 ? jumps / intervals : 0;

	const reasons: HrRejectionReason[] = [];
	if (implausibleShare > MAX_ARTEFACT_SHARE) reasons.push('implausible_values');
	if (jumpShare > MAX_ARTEFACT_SHARE) reasons.push('noisy_jumps');
	// Fastlåst krever et hopp å støtte seg på — se `MIN_PINNED_SECONDS`.
	if (longestPinnedSeconds >= MIN_PINNED_SECONDS && jumps > 0) reasons.push('pinned');

	return {
		samples: usable.length,
		implausible,
		implausibleShare: round4(implausibleShare),
		jumps,
		jumpShare: round4(jumpShare),
		longestPinnedSeconds: Math.round(longestPinnedSeconds),
		maxHr,
		minHr,
		usable: reasons.length === 0,
		reasons
	};
}

/**
 * Er en oppgitt SNITTPULS til å stole på?
 *
 * Egen sjekk fordi effort ikke leser sporet: den skåres på `avgHeartRate` fra
 * hendelsen, så en vakt over trackPoints treffer den ikke. Uten denne klemmer
 * `Math.min(1, hrr)` et snitt på 230 til full reserve, og resultatet er en
 * plausibel hard økt istedenfor et avvik.
 */
export function isCredibleAverageHr(
	avgHr: number,
	baseline: { restHr: number; maxHr: number }
): boolean {
	if (!Number.isFinite(avgHr) || avgHr <= 0) return false;
	if (avgHr > MAX_PLAUSIBLE_HR || avgHr < MIN_PLAUSIBLE_HR) return false;
	const reserve = baseline.maxHr - baseline.restHr;
	if (reserve <= 0) return false;
	return (avgHr - baseline.restHr) / reserve <= MAX_CREDIBLE_AVG_HRR;
}

/** Én linje som sier hva som ble forkastet og hvorfor. */
export function describeHrRejection(diagnosis: HrSeriesDiagnosis): string | null {
	if (diagnosis.usable || diagnosis.reasons.length === 0) return null;
	const parts: string[] = [];
	if (diagnosis.reasons.includes('implausible_values')) {
		parts.push(
			`${diagnosis.implausible} av ${diagnosis.samples} verdier utenfor ${MIN_PLAUSIBLE_HR}–${MAX_PLAUSIBLE_HR}`
		);
	}
	if (diagnosis.reasons.includes('pinned')) {
		parts.push(`fastlåst puls i ${Math.round(diagnosis.longestPinnedSeconds / 60)} min`);
	}
	if (diagnosis.reasons.includes('noisy_jumps')) {
		parts.push(`${diagnosis.jumps} ufysiologiske hopp`);
	}
	const range =
		diagnosis.minHr != null && diagnosis.maxHr != null
			? ` (målt ${diagnosis.minHr}–${diagnosis.maxHr})`
			: '';
	return `Pulskurven forkastet: ${parts.join(', ')}${range}`;
}

function round4(n: number): number {
	return Math.round(n * 10_000) / 10_000;
}
