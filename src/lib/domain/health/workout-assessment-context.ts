/**
 * Konteksten øktvurderingen bygger på.
 *
 * Se `docs/changelog/2026-08-10-oktvurdering-med-terreng-og-mal.md`.
 *
 * Fram til august 2026 fikk modellen seks tall og en liste måltitler. Den svarte
 * deretter — «tempo på 3:08/km» på en sykkeltur, «redusere vekten til 85 kg og
 * 95 kg», og et råd om å løpe mer uansett hva økta hadde vært. Ingen av delene
 * var hallusinasjon: det var alt den hadde.
 *
 * **Geografien kommer fra Ekko, ikke herfra.** Bakker, runder og strekk leses
 * utelukkende av `analysis`-feltet på opplastingen (`workout-analysis.ts`,
 * kontrakt i `docs/ekko-oktanalyse.md`). Resonans hadde en periode sin egen
 * deteksjon over trackPoints — den er fjernet. To motorer som finner «en bakke»
 * i samme spor blir aldri enige, og den ene av dem har navn og brukerens egen
 * historikk. En terskel som bare finnes ett sted er dessuten mulig å kalibrere;
 * to sett terskler i to språk er det ikke.
 *
 * Konsekvensen er bevisst: en økt uten Ekko-analyse — fra klokka, fra Dropbox,
 * fra Strava — har ingen bakker og ingen runder i vurderingen. Den har fortsatt
 * distanse, tid, puls, kilometersplitter, effort og mål.
 *
 * Modulen er ren, så det er etterprøvbart hva modellen ser. To regler den
 * håndhever, som begge har kostet en gal setning:
 *
 * - **Enhet følger idretten.** Sykkel måles i km/t. Flata visste dette allerede
 *   (`formatPaceOrSpeed`); prompten hardkodet «/km».
 * - **Ingen tomme rubrikker.** Et felt vi ikke har utelates helt, framfor å stå
 *   som «ukjent» — en modell som ser mange «ukjent» begynner å gjette.
 */

import { formatPaceOrSpeed, isWheeledSport } from '$lib/utils/activity-metrics';
import type { KmSplit } from '$lib/utils/track-stats';
import type { WorkoutAnalysis } from './workout-analysis';
// describeFramedGoals bor hos FramedGoal: helse-briefingen bruker den samme,
// og to formuleringer av samme mål blir aldri like.
import { describeFramedGoals, type FramedGoal } from './goal-horizon';

/**
 * Hvor mange kilometersplitter vi lister enkeltvis.
 *
 * Over dette blir lista lengre enn resten av prompten til sammen, og en modell
 * som drukner i rader slutter å bruke dem. Da oppsummerer vi i stedet — raskeste,
 * tregeste og spredningen — som er det man uansett ser etter.
 */
export const MAX_LISTED_SPLITS = 15;

export type AssessmentWorkout = {
	title: string;
	sportType: string;
	timestamp: string;
	distanceKm: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
	elevationMeters: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
};

export type AssessmentInput = {
	workout: AssessmentWorkout;
	splits: KmSplit[];
	/** Bakker, runder og strekk — utelukkende fra Ekko. Se filhodet. */
	analysis: WorkoutAnalysis | null;
	effort: { score: number | null; method: string | null };
	/**
	 * Pulsdrift innad i økta. Svarer på «holdt jeg det ut», som er noe annet enn
	 * EF-trenden på dashbordet («er jeg raskere per slag enn før»).
	 */
	decoupling: { driftPct: number; good: boolean } | null;
	bestEfforts: Record<string, number> | null;
	/** Ukas budsjett og belastning, med ordene flatene bruker. */
	weekStanding: { planText: string | null; loadText: string | null } | null;
	/** Sammenligning mot egen historikk (`computeWorkoutNugget`). */
	nugget: string | null;
	goals: { short: FramedGoal[]; long: FramedGoal[] };
};

function mmss(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.round(seconds % 60);
	return `${m}:${String(s).padStart(2, '0')}`;
}

function duration(seconds: number): string {
	const total = Math.round(seconds / 60);
	const h = Math.floor(total / 60);
	const m = total % 60;
	return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

function num(value: number): string {
	const r = Math.round(value * 10) / 10;
	return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

/** «4:32 /km» eller «19,1 km/t», avhengig av idretten. */
function speedText(sportType: string, secPerKm: number | null): string | null {
	if (secPerKm === null || secPerKm <= 0) return null;
	return formatPaceOrSpeed(sportType, secPerKm).replace('.', ',') || null;
}

function hrText(avg: number | null, max: number | null): string | null {
	if (avg === null && max === null) return null;
	if (avg !== null && max !== null) return `puls ${avg}/${max}`;
	return avg !== null ? `puls ${avg}` : `maks ${max}`;
}

/** Splittene som er verdt å nevne, som ferdige linjer. */
export function describeSplits(sportType: string, splits: KmSplit[]): string[] {
	const full = splits.filter((s) => !s.isPartial);
	if (full.length === 0) return [];

	const line = (s: KmSplit): string => {
		const parts = [`km ${s.kmIndex}: ${speedText(sportType, s.paceSecondsPerKm) ?? mmss(s.durationSec)}`];
		if (s.avgHr !== null) parts.push(`puls ${Math.round(s.avgHr)}`);
		if (s.elevationGainM >= 5) parts.push(`+${Math.round(s.elevationGainM)} hm`);
		return parts.join(', ');
	};

	if (full.length <= MAX_LISTED_SPLITS) return full.map(line);

	// For mange til å liste: si det som betyr noe i stedet.
	const sorted = [...full].sort((a, b) => a.paceSecondsPerKm - b.paceSecondsPerKm);
	const fastest = sorted[0];
	const slowest = sorted[sorted.length - 1];
	const spreadSec = slowest.paceSecondsPerKm - fastest.paceSecondsPerKm;
	return [
		`${full.length} hele kilometer`,
		`raskeste ${line(fastest)}`,
		`tregeste ${line(slowest)}`,
		`spredning ${mmss(spreadSec)} mellom raskeste og tregeste`
	];
}


const KIND_LABEL: Record<string, string> = {
	hill: 'Bakke',
	track: 'Bane',
	stretch: 'Strekk'
};

/**
 * Ekkos navngitte strekninger — den delen som gjør et tall til en beskjed.
 *
 * Sammenligningen mot medianen skrives ut som differanse, ikke som to tall ved
 * siden av hverandre: «12 s raskere enn medianen din» er det modellen skal
 * kunne gjenta, og en modell som må regne selv regner av og til feil.
 */
export function describeFeatures(analysis: WorkoutAnalysis | null): string[] {
	if (!analysis) return [];

	return analysis.features.map((f) => {
		const label = KIND_LABEL[f.kind] ?? 'Strekning';
		const named = f.startName && f.endName ? `${f.name} (${f.startName} → ${f.endName})` : f.name;
		const parts = [`${label} «${named}»`];

		if (f.durationSec !== null) parts.push(mmss(f.durationSec));
		if (f.distanceMeters !== null) parts.push(`${Math.round(f.distanceMeters)} m`);
		if (f.elevationGainM !== null && f.elevationGainM >= 5) parts.push(`+${Math.round(f.elevationGainM)} hm`);
		const hr = hrText(f.avgHeartRate, f.maxHeartRate);
		if (hr) parts.push(hr);

		const h = f.history;
		if (h && h.completions > 0) {
			const context: string[] = [`${h.completions}. gang`];
			if (h.medianDurationSec !== null && f.durationSec !== null) {
				const delta = Math.round(h.medianDurationSec - f.durationSec);
				context.push(
					delta === 0
						? 'på medianen din'
						: `${mmss(Math.abs(delta))} ${delta > 0 ? 'raskere' : 'tregere'} enn medianen din`
				);
			}
			if (h.medianAvgHeartRate !== null && f.avgHeartRate !== null) {
				const delta = Math.round(f.avgHeartRate - h.medianAvgHeartRate);
				if (delta !== 0) {
					context.push(`${Math.abs(delta)} slag ${delta > 0 ? 'høyere' : 'lavere'} puls enn vanlig`);
				}
			}
			if (h.bestDurationSec !== null && f.durationSec !== null && f.durationSec <= h.bestDurationSec) {
				context.push('ny bestetid');
			}
			parts.push(`— ${context.join(', ')}`);
		}

		return parts.join(', ').replace(', —', ' —');
	});
}

/**
 * Ekkos egne runder — talt live mot ankeret brukeren satte, med «din vanlige
 * runde her» der historikken holder (Ekko krever tre tidligere runder på samme
 * bane før den påstår en median).
 */
export function describeAnalysisLaps(analysis: WorkoutAnalysis | null): string[] {
	if (!analysis) return [];

	return analysis.laps.map((lap) => {
		const parts = [`runde ${lap.index}`];
		if (lap.durationSec !== null) parts.push(mmss(lap.durationSec));
		if (lap.distanceMeters !== null) parts.push(`${Math.round(lap.distanceMeters)} m`);
		if (lap.avgHeartRate !== null) parts.push(`puls ${lap.avgHeartRate}`);

		const h = lap.history;
		if (h && h.medianDurationSec !== null && lap.durationSec !== null) {
			const delta = Math.round(h.medianDurationSec - lap.durationSec);
			parts.push(
				delta === 0
					? '— på din vanlige rundetid her'
					: `— ${mmss(Math.abs(delta))} ${delta > 0 ? 'raskere' : 'tregere'} enn din vanlige runde her`
			);
		}
		return parts.join(', ').replace(', —', ' —');
	});
}

/** Bakkedrag fra en strukturert bakkeøkt, med sonefordeling der den finnes. */
export function describeHillReps(analysis: WorkoutAnalysis | null): string[] {
	if (!analysis) return [];

	return analysis.hillReps.map((rep) => {
		const parts = [`drag ${rep.index}`];
		if (rep.durationSec !== null) parts.push(mmss(rep.durationSec));
		if (rep.distanceMeters !== null) parts.push(`${Math.round(rep.distanceMeters)} m`);
		const hr = hrText(rep.avgHeartRate, rep.peakHeartRate);
		if (hr) parts.push(hr);
		if (rep.secondsInZone) {
			// Bare den dominerende sonen: fem tall per drag over ti drag er en
			// tabell, ikke en observasjon.
			const max = Math.max(...rep.secondsInZone);
			if (max > 0) parts.push(`mest i Z${rep.secondsInZone.indexOf(max) + 1}`);
		}
		return parts.join(', ');
	});
}

function section(title: string, lines: string[]): string | null {
	if (lines.length === 0) return null;
	return `${title}:\n${lines.map((l) => (l.startsWith('-') ? l : `- ${l}`)).join('\n')}`;
}

/** Bygger kontekstblokken. Rene fakta — instruksene bor i systemmeldingen. */
export function buildAssessmentContext(input: AssessmentInput): string {
	const { workout: w } = input;
	const wheeled = isWheeledSport(w.sportType);

	const summary: string[] = [`${w.title} (${w.sportType})`];
	if (w.distanceKm !== null) summary.push(`${num(w.distanceKm)} km`);
	if (w.durationSeconds !== null) summary.push(duration(w.durationSeconds));
	const speed = speedText(w.sportType, w.paceSecondsPerKm);
	if (speed) summary.push(`${wheeled ? 'snittfart' : 'snittempo'} ${speed}`);
	if (w.elevationMeters !== null) summary.push(`${Math.round(w.elevationMeters)} høydemeter`);
	const hr = hrText(w.avgHeartRate, w.maxHeartRate);
	if (hr) summary.push(hr);
	if (input.decoupling) {
		const d = input.decoupling;
		const sign = d.driftPct >= 0 ? '' : '−';
		summary.push(
			`pulsdrift ${sign}${Math.abs(d.driftPct).toFixed(1).replace('.', ',')} % (${d.good ? 'jevn' : 'dro oppover'})`
		);
	}
	if (input.effort.score !== null) {
		summary.push(`effort ${num(input.effort.score)}${input.effort.method ? ` (${input.effort.method})` : ''}`);
	}

	const best = input.bestEfforts
		? Object.entries(input.bestEfforts)
				.filter(([, sec]) => typeof sec === 'number' && sec > 0)
				.map(([dist, sec]) => `${dist}: ${mmss(sec)}`)
		: [];

	const blocks = [
		section('Økt', summary),
		// Navngitte strekninger først: de er det eneste modellen ikke kunne
		// utledet selv, og det brukeren kjenner igjen.
		section('Strekninger (med din egen historikk)', describeFeatures(input.analysis)),
		section('Runder', describeAnalysisLaps(input.analysis)),
		section('Bakkedrag', describeHillReps(input.analysis)),
		section('Kilometer', describeSplits(w.sportType, input.splits)),
		section('Raskeste sammenhengende strekk i økta', best),
		input.nugget ? section('Mot egen historikk', [input.nugget]) : null,
		input.weekStanding
			? section(
					'Uka så langt',
					[input.weekStanding.planText, input.weekStanding.loadText].filter((t): t is string => Boolean(t))
				)
			: null,
		section('Kortsiktige mål', describeFramedGoals(input.goals.short)),
		section('Lange og løpende mål', describeFramedGoals(input.goals.long))
	].filter((b): b is string => b !== null);

	return blocks.join('\n\n');
}

/**
 * Systemmeldingen.
 *
 * «Avslutt med ett enkelt råd» sto i den gamle prompten og var grunnen til at
 * vurderingen maste: den MÅTTE levere et råd hver gang, og med bare distanse og
 * tempo tilgjengelig var «løp mer og fortere» det eneste rådet som fantes. Nå er
 * rådet betinget — «ingenting å endre» er et gyldig svar.
 */
export const ASSESSMENT_SYSTEM_PROMPT = `Du er treningscoachen til denne brukeren. Du kjenner historikken deres og snakker norsk, kort og direkte.

Skriv 2–4 setninger om økta.

Regler:
- Bruk tallene du får. Nevn konkrete strekninger, runder eller kilometer ved navn og tid når de finnes.
- Navngitte strekninger og sammenligning mot brukerens egen historikk er det mest verdifulle du har. Bruk det først.
- Enhetene i konteksten er allerede riktige for idretten. Ikke regn om, og ikke omtal sykling som løping.
- Vurder økta mot målene som faktisk er relevante for DENNE idretten. En sykkeltur skal ikke måles mot et løpemål.
- Ikke gjenta tall brukeren ser rett over teksten (distanse, varighet, snittfart) med mindre du sier noe om dem.
- Gi et råd bare når du har dekning for det. «Solid økt, ingenting å endre» er et fullgodt svar, og bedre enn et påfunn.
- Ingen medisinske påstander. Du måler tid, puls og høyde — ikke helse.
- Ikke oppmuntring på tomgang. Ingen utropstegn.`;
