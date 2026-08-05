/**
 * Fra rå vektrader til målinger, og endringssetningen om kroppssammensetning.
 *
 * Ligger i domenelaget framfor i `server/weight-dashboard.ts` fordi det er
 * nettopp disse to tolkningene som kan gå galt — og en ren funksjon kan testes
 * uten å mocke en database. Se CLAUDE.md.
 */

import { osloDayKey } from '$lib/domain/oslo-time';
import {
	describeCompositionChange,
	normalizeBodyComposition,
	type BodyComposition
} from './body-composition';
import { dayNumber, type WeightDay, type WeightMeasurement } from './weight-series';

/** Feltene en `dataType: 'weight'`-rad kan ha fra Withings. */
export interface WeightEventData {
	weight?: number;
	/** Måletype 8 — fettmasse i kg. */
	fatMassKg?: number;
	/** Måletype 6 — fettprosent. */
	fatRatio?: number;
	/** Legacy: historisk lagret måletype 6, altså en PROSENT tross navnet. */
	fatMass?: number;
	muscleMass?: number;
	fatFreeMass?: number;
	boneMass?: number;
	hydration?: number;
}

/**
 * Rå rader → målinger med normalisert kroppssammensetning.
 *
 * `normalizeBodyComposition` er ikke valgfri. Historiske rader har fettPROSENT i
 * `data.fatMass` tross feltnavnet, og en fettmassegraf bygget rett på det feltet
 * ville vist 22 kg der svaret er 18 — samme feil som kostet et fettmasse-mål i
 * august. Se docs/changelog/2026-08-03-withings-flere-felt.md.
 */
export function toWeightMeasurements(
	rows: Array<{ timestamp: Date; data: unknown }>
): WeightMeasurement[] {
	const measurements: WeightMeasurement[] = [];

	for (const row of rows) {
		const data = (row.data ?? {}) as WeightEventData;
		const weightKg = typeof data.weight === 'number' ? data.weight : null;
		if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) continue;

		const composition = normalizeBodyComposition({
			weightKg,
			fatMassKg: data.fatMassKg ?? null,
			fatRatio: data.fatRatio ?? null,
			legacyFatMass: data.fatMass ?? null,
			muscleMassKg: data.muscleMass ?? null,
			fatFreeMassKg: data.fatFreeMass ?? null,
			boneMassKg: data.boneMass ?? null,
			hydrationKg: data.hydration ?? null
		});

		measurements.push({
			date: osloDayKey(row.timestamp),
			weightKg,
			fatMassKg: composition.fatMassKg,
			fatRatio: composition.fatRatio,
			muscleMassKg: composition.muscleMassKg,
			fatFreeMassKg: composition.fatFreeMassKg
		});
	}

	return measurements;
}

/** Vinduet endringssetningen måles over. */
export const COMPOSITION_WINDOW_DAYS = 90;

export interface CompositionChangeSummary {
	/** Faktisk avstand mellom de to målingene, ikke det ønskede vinduet. */
	windowDays: number;
	fromDate: string;
	toDate: string;
	sentence: string;
	/**
	 * Fettendringen delt på vektendringen. **Ikke garantert mellom 0 og 1** — falt
	 * fettet mer enn vekta fordi muskelen økte, blir den over 1. Bruk
	 * `interpretCompositionChange` framfor å formatere den som en prosent.
	 */
	fatShare: number | null;
	/** Rådeltaene, slik en flate kan formulere seg om dem uten å regne selv. */
	weightDeltaKg: number;
	fatDeltaKg: number | null;
	muscleDeltaKg: number | null;
}

function asComposition(day: WeightDay): BodyComposition {
	return {
		fatMassKg: day.fatMassKg,
		fatRatio: day.fatRatio,
		muscleMassKg: day.muscleMassKg,
		fatFreeMassKg: day.fatFreeMassKg,
		boneMassKg: null,
		hydrationKg: null,
		fatMassSource: day.fatMassKg === null ? null : 'measured'
	};
}

/**
 * «Ned 1,4 kg — −1,2 kg fett, −0,9 kg muskel» over de siste tre månedene.
 *
 * Dette er hele grunnen til at kroppssammensetning hentes: vekta alene kan ikke
 * skille et vekttap man vil ha fra et man ikke vil ha.
 *
 * Krever fettmåling i BEGGE ender, og faller tilbake på den eldste målingen med
 * fett når ingen ligger så langt tilbake som vinduet ber om. `windowDays`
 * rapporterer da den faktiske avstanden — ellers ville setningen påstått tre
 * måneder der grunnlaget var tre uker.
 */
export function summarizeCompositionChange(
	days: WeightDay[],
	windowDays = COMPOSITION_WINDOW_DAYS
): CompositionChangeSummary | null {
	const withFat = days.filter((day) => day.fatMassKg !== null);
	if (withFat.length < 2) return null;

	const to = withFat.at(-1)!;
	const target = dayNumber(to.date) - windowDays;

	let from = withFat[0];
	for (const day of withFat) {
		if (dayNumber(day.date) > target) break;
		from = day;
	}
	if (from.date === to.date) return null;

	const change = describeCompositionChange(
		{ weightKg: from.weightKg, composition: asComposition(from) },
		{ weightKg: to.weightKg, composition: asComposition(to) }
	);
	if (!change) return null;

	return {
		windowDays: dayNumber(to.date) - dayNumber(from.date),
		fromDate: from.date,
		toDate: to.date,
		sentence: change.sentence,
		fatShare: change.fatShare,
		weightDeltaKg: change.weightKg,
		fatDeltaKg: change.fatMassKg,
		muscleDeltaKg: change.muscleMassKg
	};
}

/**
 * Setningen som forklarer hva endringen betyr, eller null når den ikke betyr noe.
 *
 * ## Hvorfor `fatShare` ikke kan formateres rett som en prosent
 *
 * Andelen er fettendringen delt på vektendringen, og den er bare en «andel av» når
 * de to peker samme vei og fettet ikke falt mer enn totalen. Mot en ekte database
 * kom `fatShare: 2` ut med én gang: vekta ned 0,2 kg, fettet ned 0,4 kg, muskelen
 * opp 0,1. Flaten skrev «200 % av endringen er fett».
 *
 * Det tilfellet er ikke en feil — det er den *beste* utfallet man kan ha, og
 * fortjener sin egen setning framfor et umulig prosenttall.
 */
export function interpretCompositionChange(
	change: CompositionChangeSummary | null
): string | null {
	if (!change || change.fatDeltaKg === null) return null;

	const { weightDeltaKg, fatDeltaKg, muscleDeltaKg } = change;

	// Fettet falt mer enn vekta: muskel eller vann tok igjen differansen. Beste
	// utfall, og setningen skal si det framfor å regne en andel over 100 %.
	if (fatDeltaKg < 0 && Math.abs(fatDeltaKg) > Math.abs(weightDeltaKg) + 0.05) {
		return muscleDeltaKg !== null && muscleDeltaKg > 0
			? 'Fettet falt mer enn vekta — muskelmassen gikk opp i samme periode. Det er det beste utfallet.'
			: 'Fettet falt mer enn vekta selv, så noe annet enn fett har økt.';
	}

	// Vekt ned og fett ned i takt: andelen er meningsfull.
	if (weightDeltaKg < 0 && fatDeltaKg < 0 && change.fatShare !== null) {
		const pct = Math.round(Math.min(1, change.fatShare) * 100);
		return `${pct} % av nedgangen er fett. Vekta alene kan ikke skille et vekttap du vil ha fra et du ikke vil ha — det er derfor fettmassen står her.`;
	}

	// Vekt ned, men fettet står stille eller stiger: nedgangen er noe annet.
	if (weightDeltaKg < 0 && fatDeltaKg >= 0) {
		return 'Vekta gikk ned, men fettmassen gjorde det ikke. Nedgangen ligger i muskel eller væske.';
	}

	// Vekt opp: si hva som økte, ikke om det er bra.
	if (weightDeltaKg > 0) {
		return fatDeltaKg > 0
			? 'Vekta gikk opp, og fettmassen med den.'
			: 'Vekta gikk opp, men ikke fettmassen.';
	}

	return null;
}
