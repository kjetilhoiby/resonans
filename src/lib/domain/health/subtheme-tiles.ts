/**
 * Undertema-stripen på helse-mortemaet: ett tall per undertema.
 *
 * Poenget er å svare «hvor står hver gren» uten å rendre fem dashboards. Hver
 * flis har derfor nøyaktig én verdi og én retning — resten hører hjemme på
 * undertemaet selv.
 */

import { HEALTH_SUBTHEMES, type HealthSubtheme } from '$lib/domain/health-subthemes';

export type TileTone = 'nøytral' | 'positiv' | 'varsel';

export interface SubthemeTile {
	name: string;
	emoji: string;
	kind: HealthSubtheme['kind'];
	/** Temaets id, eller null når undertemaet ikke er opprettet ennå. */
	themeId: string | null;
	/** Formatert hovedtall, eller null når kilden mangler data. */
	value: string | null;
	unit: string | null;
	/** Kort endringstekst, f.eks. «+12 mot snittet». */
	delta: string | null;
	tone: TileTone;
	/** Sann når undertemaet finnes, men kilden ikke har levert data. */
	empty: boolean;
}

export interface SubthemeTileInput {
	/** Temanavn → id for undertemaene brukeren faktisk har. */
	themeIdsByName: Record<string, string>;
	weeklyEffort?: { total?: number; baseline?: { p4wAvg?: number; delta?: number } } | null;
	/** Siste veiing i kg — hovedtallet på Vekt-flisen. */
	weightKg?: number | null;
	weightChange30d?: number | null;
	/** Loggede makroer, snitt per logget dag i siste uke. */
	nutrition?: { kcalPerDay?: number; proteinPerDay?: number; loggedDays?: number } | null;
	egenfrekvens?: { recentAvg?: number | null; direction?: string | null } | null;
	sleepAvgHours?: number | null;
	/** Selvrapporterte urolige netter i siste uke. */
	sleepDisturbedNights?: number | null;
	screenTimeAvgPerDayMinutes?: number | null;
}

function nb(value: number, decimals = 1): string {
	return value.toFixed(decimals).replace('.', ',');
}

function signed(value: number, decimals = 1): string {
	const formatted = nb(Math.abs(value), decimals);
	return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

function minutesToHhMm(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	return h > 0 ? `${h} t ${m} min` : `${m} min`;
}

/**
 * NB: retningen betyr ikke det samme for alle metrikkene. Vekt ned er bra,
 * skjermtid ned er bra, men søvn ned er dårlig. Å behandle «mindre» som
 * universelt positivt er den enkleste måten å gjøre stripen misvisende på.
 */
function buildTraining(input: SubthemeTileInput): Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'> {
	const total = input.weeklyEffort?.total;
	if (typeof total !== 'number') {
		return { value: null, unit: null, delta: null, tone: 'nøytral', empty: true };
	}
	const delta = input.weeklyEffort?.baseline?.delta;
	return {
		value: String(Math.round(total)),
		unit: 'effort',
		delta: typeof delta === 'number' ? `${signed(delta, 0)} mot snittet` : null,
		// Mer trening er positivt; markant mindre er et varsel.
		tone: typeof delta !== 'number' ? 'nøytral' : delta > 0 ? 'positiv' : delta < -20 ? 'varsel' : 'nøytral',
		empty: false
	};
}

/**
 * Loggede kalorier per dag.
 *
 * Flisen falt tidligere tilbake på vektendringen når ingenting var logget. Den
 * fallbacken er borte: Vekt er et eget undertema nå, og to naboliggende fliser
 * som viser samme tall gjør stripen vanskeligere å lese, ikke lettere.
 */
function buildNutrition(input: SubthemeTileInput): Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'> {
	const kcal = input.nutrition?.kcalPerDay;
	const loggedDays = input.nutrition?.loggedDays ?? 0;
	if (typeof kcal !== 'number' || kcal <= 0 || loggedDays <= 0) {
		return { value: null, unit: null, delta: null, tone: 'nøytral', empty: true };
	}

	const protein = input.nutrition?.proteinPerDay;
	return {
		value: Math.round(kcal).toLocaleString('nb-NO'),
		unit: 'kcal/dag',
		delta:
			typeof protein === 'number' && protein > 0
				? `${Math.round(protein)} g protein · ${loggedDays} ${loggedDays === 1 ? 'dag' : 'dager'}`
				: `${loggedDays} ${loggedDays === 1 ? 'dag' : 'dager'} logget`,
		// Ingen tone på inntak: vi kjenner ikke brukerens mål, og et grønt
		// eller gult kort ville dømt et tall vi ikke har terskel for.
		tone: 'nøytral',
		empty: false
	};
}

/**
 * Vekta selv som hovedtall, med 30-dagersendringen som undertekst.
 *
 * Nivået står øverst framfor endringen fordi det er tallet man kjenner igjen —
 * «82,4» sier hvor du er, «−0,6» sier bare at noe skjedde. Endringen er
 * konteksten, ikke overskriften.
 */
function buildWeight(input: SubthemeTileInput): Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'> {
	const kg = input.weightKg;
	const change = input.weightChange30d;

	if (typeof kg !== 'number') {
		// Uten en siste veiing, men med en endring, er endringen det eneste vi har.
		if (typeof change !== 'number') {
			return { value: null, unit: null, delta: null, tone: 'nøytral', empty: true };
		}
		return {
			value: signed(change),
			unit: 'kg',
			delta: 'siste 30 dager',
			tone: change < -0.2 ? 'positiv' : 'nøytral',
			empty: false
		};
	}

	return {
		value: nb(kg),
		unit: 'kg',
		delta: typeof change === 'number' ? `${signed(change)} kg på 30 dager` : null,
		// Ned regnes som ønsket retning; oppgang er nøytral, ikke varsel — vi
		// kjenner ikke brukerens intensjon, og et rødt kort ville dømt for hardt.
		tone: typeof change === 'number' && change < -0.2 ? 'positiv' : 'nøytral',
		empty: false
	};
}

function buildEgenfrekvens(input: SubthemeTileInput): Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'> {
	const recent = input.egenfrekvens?.recentAvg;
	if (typeof recent !== 'number') {
		return { value: null, unit: null, delta: null, tone: 'nøytral', empty: true };
	}
	const direction = input.egenfrekvens?.direction ?? null;
	return {
		value: nb(recent),
		unit: 'av 5',
		delta: direction,
		tone: direction === 'nedgang' ? 'varsel' : direction === 'oppgang' ? 'positiv' : 'nøytral',
		empty: false
	};
}

function buildSleep(input: SubthemeTileInput): Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'> {
	const hours = input.sleepAvgHours;
	const disturbedFallback = input.sleepDisturbedNights ?? 0;
	if (typeof hours !== 'number') {
		// Uten varighet fra Withings, men med selvrapporterte netter, er antallet
		// urolige netter det eneste flisen har — og det er bedre enn tomt.
		if (disturbedFallback > 0) {
			return {
				value: String(disturbedFallback),
				unit: disturbedFallback === 1 ? 'urolig natt' : 'urolige netter',
				delta: 'siste uke',
				tone: 'varsel',
				empty: false
			};
		}
		return { value: null, unit: null, delta: null, tone: 'nøytral', empty: true };
	}
	// Urolige netter overstyrer varigheten: sju timer der to av dem var
	// våkenliggende er ikke sju gode timer, og flisen skal ikke si «positiv» da.
	const disturbed = input.sleepDisturbedNights ?? 0;
	const byHours = hours < 6.5 ? 'varsel' : hours >= 7 ? 'positiv' : 'nøytral';

	return {
		value: nb(hours),
		unit: 'timer/natt',
		delta:
			disturbed > 0
				? `${disturbed} ${disturbed === 1 ? 'urolig natt' : 'urolige netter'}`
				: 'siste uke',
		// Her er lite dårlig — motsatt av vekt og skjermtid.
		tone: disturbed >= 2 ? 'varsel' : disturbed === 1 && byHours === 'positiv' ? 'nøytral' : byHours,
		empty: false
	};
}

function buildScreenTime(input: SubthemeTileInput): Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'> {
	const minutes = input.screenTimeAvgPerDayMinutes;
	if (typeof minutes !== 'number') {
		return { value: null, unit: null, delta: null, tone: 'nøytral', empty: true };
	}
	return {
		value: minutesToHhMm(minutes),
		unit: 'per dag',
		delta: 'siste uke',
		tone: minutes >= 240 ? 'varsel' : minutes <= 120 ? 'positiv' : 'nøytral',
		empty: false
	};
}

const BUILDERS: Record<string, (input: SubthemeTileInput) => Pick<SubthemeTile, 'value' | 'unit' | 'delta' | 'tone' | 'empty'>> = {
	Trening: buildTraining,
	Ernæring: buildNutrition,
	Vekt: buildWeight,
	Egenfrekvens: buildEgenfrekvens,
	Søvn: buildSleep,
	Skjermtid: buildScreenTime
};

/**
 * Én flis per undertema, i HEALTH_SUBTHEMES-rekkefølge. Undertemaer som ikke er
 * opprettet ennå får `themeId: null` og vises dempet — men de skal fortsatt
 * kunne klikkes, siden det er der man kobler kilden.
 *
 * Et nytt undertema MÅ ha en builder her. Oppslaget er på navn, så et navn uten
 * builder gir «BUILDERS[...] is not a function» på hele mor-flaten — ikke en tom
 * flis. Vakten under gjør det til en tom flis i stedet.
 */
export function buildSubthemeTiles(input: SubthemeTileInput): SubthemeTile[] {
	return HEALTH_SUBTHEMES.map((subtheme) => {
		const builder = BUILDERS[subtheme.name];
		if (!builder) {
			console.warn(`[helse] Undertemaet «${subtheme.name}» mangler en flis-builder.`);
			return {
				name: subtheme.name,
				emoji: subtheme.emoji,
				kind: subtheme.kind,
				themeId: input.themeIdsByName[subtheme.name] ?? null,
				value: null,
				unit: null,
				delta: null,
				tone: 'nøytral' as TileTone,
				empty: true
			};
		}
		const built = builder(input);
		return {
			name: subtheme.name,
			emoji: subtheme.emoji,
			kind: subtheme.kind,
			themeId: input.themeIdsByName[subtheme.name] ?? null,
			...built
		};
	});
}
