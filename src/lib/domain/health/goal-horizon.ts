/**
 * Mål som en coach kan snakke om: med progresjon, enhet og horisont.
 *
 * Se `docs/changelog/2026-08-10-oktvurdering-med-terreng-og-mal.md`.
 *
 * Fram til august 2026 fikk øktvurderingen måltitlene rått konkatenert — «for å
 * redusere vekten til 85 kg og 95 kg», «mål om å løpe 200 km og 600 km». To tall
 * som ser motstridende ut fordi det ene er neste delmål og det andre er årsmålet,
 * og modellen hadde ingen måte å vite hvilket som var hvilket. Verdiene lå i
 * `sensor_goals` med `currentValue` og `unit` hele tiden; vurderingen leste dem
 * bare aldri.
 *
 * Ren modul: tar rader inn, gir formulerte linjer ut. Ingen DB.
 */

/** Hvor langt fram et mål må ligge for å regnes som langsiktig. */
export const LONG_HORIZON_DAYS = 90;

export type GoalHorizon = 'kort' | 'lang' | 'løpende';

export type GoalInput = {
	title: string;
	description: string | null;
	targetDate: Date | null;
	/** '2026' | '2026-Q1' | '2026-04' | null (løpende) */
	periodKey: string | null;
	status: string;
	/** Fra `sensor_goals`, når målet er sensorkoblet. */
	sensor: {
		metricType: string | null;
		targetValue: number | null;
		currentValue: number | null;
		baselineValue: number | null;
		unit: string | null;
	} | null;
};

export type FramedGoal = {
	title: string;
	horizon: GoalHorizon;
	daysLeft: number | null;
	/** Ferdig setning om hvor målet står. Null når vi ikke vet noe tallfestet. */
	progressText: string | null;
	/** 0–1 der det lar seg regne. Brukes til sortering, ikke til visning. */
	completion: number | null;
	paused: boolean;
};

function formatNumber(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded)
		? String(rounded)
		: rounded.toFixed(1).replace('.', ',');
}

/**
 * Horisonten et mål har.
 *
 * `targetDate` vinner over `periodKey`: en dato er alltid mer presis enn en
 * periode. Uten begge er målet løpende — «hold vekta» har ingen frist, og å
 * kalle det kortsiktig ville gitt en coach som maser om noe som aldri forfaller.
 */
export function goalHorizon(
	goal: Pick<GoalInput, 'targetDate' | 'periodKey'>,
	now: Date
): { horizon: GoalHorizon; daysLeft: number | null } {
	if (goal.targetDate && Number.isFinite(goal.targetDate.getTime())) {
		const daysLeft = Math.ceil((goal.targetDate.getTime() - now.getTime()) / 86_400_000);
		return { horizon: daysLeft <= LONG_HORIZON_DAYS ? 'kort' : 'lang', daysLeft };
	}

	if (goal.periodKey) {
		// Et årsmål er langt, en måned eller et kvartal er kort. Vi regner ikke ut
		// dager her: periodKey sier hvilken bøtte, ikke når i den vi er.
		const isYear = /^\d{4}$/.test(goal.periodKey);
		return { horizon: isYear ? 'lang' : 'kort', daysLeft: null };
	}

	return { horizon: 'løpende', daysLeft: null };
}

/**
 * Hvor målet står, som en setning.
 *
 * To retninger, og de kan ikke deles: for «løp 600 km» er høyere bedre og
 * `currentValue` teller oppover mot målet. For «ned til 85 kg» er lavere bedre,
 * og framgangen måles fra `baselineValue` — uten den vet vi ikke om 88 kg er
 * nesten i mål eller nettopp begynt.
 */
export function describeProgress(
	sensor: NonNullable<GoalInput['sensor']>
): { text: string; completion: number | null } | null {
	const { targetValue, currentValue, baselineValue, unit } = sensor;
	if (targetValue === null || currentValue === null) return null;

	const u = unit ? ` ${unit}` : '';
	const current = formatNumber(currentValue);
	const target = formatNumber(targetValue);

	// Nedadgående mål: målet ligger under utgangspunktet.
	const descending = baselineValue !== null && targetValue < baselineValue;

	if (descending) {
		const span = baselineValue - targetValue;
		const done = baselineValue - currentValue;
		const completion = span > 0 ? Math.max(0, Math.min(1, done / span)) : null;
		const remaining = currentValue - targetValue;
		if (remaining <= 0) {
			return { text: `${current}${u} — målet på ${target}${u} er nådd`, completion: 1 };
		}
		return {
			text: `${current}${u} av ${target}${u} (${formatNumber(remaining)}${u} igjen, fra ${formatNumber(baselineValue)}${u})`,
			completion
		};
	}

	// Oppadgående mål — det vanlige for distanse og antall.
	const completion = targetValue > 0 ? Math.max(0, Math.min(1, currentValue / targetValue)) : null;
	const remaining = targetValue - currentValue;
	if (remaining <= 0) {
		return { text: `${current}${u} av ${target}${u} — nådd`, completion: 1 };
	}
	return {
		text: `${current}${u} av ${target}${u} (${formatNumber(remaining)}${u} igjen)`,
		completion
	};
}

export function frameGoal(goal: GoalInput, now: Date): FramedGoal {
	const { horizon, daysLeft } = goalHorizon(goal, now);
	const progress = goal.sensor ? describeProgress(goal.sensor) : null;

	return {
		title: goal.title,
		horizon,
		daysLeft,
		progressText: progress?.text ?? null,
		completion: progress?.completion ?? null,
		paused: goal.status === 'paused'
	};
}

/**
 * Sorterer mål slik at de mest handlingsbare kommer først, og deler dem i korte
 * og lange. Rekkefølgen betyr noe: en modell med et tak på kontekst leser toppen.
 *
 * Innenfor hver horisont: nærmeste frist først, deretter de med tallfestet
 * progresjon (et mål vi kan si noe konkret om slår ett vi bare kan gjenta
 * tittelen på), og pausede sist.
 */
export function frameGoals(
	goals: GoalInput[],
	now: Date
): { short: FramedGoal[]; long: FramedGoal[] } {
	const framed = goals.map((g) => frameGoal(g, now));

	const rank = (a: FramedGoal, b: FramedGoal): number => {
		if (a.paused !== b.paused) return a.paused ? 1 : -1;
		if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
		if (a.daysLeft !== null) return -1;
		if (b.daysLeft !== null) return 1;
		const aHas = a.progressText !== null;
		const bHas = b.progressText !== null;
		if (aHas !== bHas) return aHas ? -1 : 1;
		return 0;
	};

	return {
		short: framed.filter((g) => g.horizon === 'kort').sort(rank),
		// Løpende mål hører sammen med de lange: begge svarer på «hvor er vi på vei»,
		// ikke på «hva haster nå».
		long: framed.filter((g) => g.horizon !== 'kort').sort(rank)
	};
}
