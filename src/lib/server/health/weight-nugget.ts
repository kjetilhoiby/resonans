/**
 * Krydderet på en veiing — datainnhentingen. Reglene bor rent i
 * `$lib/domain/health/weight-nugget-rules.ts`.
 *
 * Se `docs/changelog/2026-09-04-krydder-paa-veiingen.md`.
 *
 * Samme arbeidsdeling som `$lib/server/workout-nuggets.ts`: denne modulen
 * henter, den rene modulen bestemmer. Historikken og målvekta leses med de
 * samme funksjonene Vekt-flaten bruker, slik at pushen ikke kan komme til å si
 * noe annet enn flaten den lenker til.
 */

import { osloDayKey } from '$lib/domain/oslo-time';
import {
	buildWeightPush,
	type WeightNuggetInput,
	type WeightPushCopy
} from '$lib/domain/health/weight-nugget-rules';
import { readWeightDays } from '$lib/server/health/weight-history';
import { readActiveWeightGoal } from '$lib/server/health/weight-goal-track';
import { readHealthMetricSettings, readMetricNumber } from '$lib/server/health/metric-settings';

/**
 * Bygger tittel og body til vekt-pushen.
 *
 * Historikken leses med `readWeightDays`, altså samme vindu som flaten. Et
 * kortere vindu her ville gjort «laveste snittvekt vi har målt» til en påstand
 * om de siste par årene, uten at noe sa fra: rekorden ville sett like sikker ut.
 */
export async function computeWeightPush(args: {
	userId: string;
	/** Målingen som nettopp ble skrevet. */
	latestKg: number | null;
	/** Settes i tester; ellers dagens Oslo-dato. */
	now?: Date;
}): Promise<WeightPushCopy> {
	const input = await gatherWeightNuggetInput(args);
	return buildWeightPush({ ...input, latestKg: args.latestKg });
}

/**
 * Inngangen til vektreglene, uten å velge blant dem. Delt av pushen og
 * hjemskjermens brev (`$lib/server/home-letter.ts`).
 */
export async function gatherWeightNuggetInput(args: {
	userId: string;
	now?: Date;
}): Promise<WeightNuggetInput> {
	const { userId } = args;
	const now = args.now ?? new Date();
	const today = osloDayKey(now);

	const [days, metricSettings] = await Promise.all([
		readWeightDays(userId, { now }),
		readHealthMetricSettings(userId)
	]);

	// Målet leses ETTER historikken: fallback-baselinen er første måling på eller
	// etter målets startdato, og den kan bare regnes når begge finnes.
	const goal = await readActiveWeightGoal(userId, { weightDays: days, today }).catch((err) => {
		console.error(
			`[withings-sync] vektmål-oppslag feilet user=${userId}: ${err instanceof Error ? err.message : String(err)}`
		);
		return null;
	});

	return {
		days,
		today,
		goalKg: readMetricNumber(metricSettings, 'weight', 'goal'),
		goal
	};
}
