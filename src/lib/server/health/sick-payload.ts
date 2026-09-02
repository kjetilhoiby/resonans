/**
 * sick-payload.ts — det ENE svaret alle syk-endepunktene returnerer.
 *
 * Endepunktene under `/api/helse/syk` og `/api/helse/symptomer` muterer ulike
 * ting, men flaten trenger den samme helheten etterpå: perioder, symptomer,
 * temperatur og et eventuelt spørsmål. Bygget her, så en mutasjon aldri kan
 * returnere et delvis bilde flaten så tegner over det den hadde.
 *
 * Setningene («text») kommer fra domenelaget, ikke fra flaten — helsechatten må
 * si det samme som skjermen.
 */

import {
	describeSickPeriod,
	resolveSickPeriod,
	type SickPeriod
} from '$lib/domain/health/sick-periods';
import {
	describeSymptom,
	resolveSymptom,
	summarizeSymptoms,
	type Symptom
} from '$lib/domain/health/symptoms';
import {
	describeCoreTemperature,
	describeSkinTemperature
} from '$lib/domain/health/temperature';
import { getSickState, listSickPeriods, todayOsloKey } from './sick-log';
import { listSymptoms, symptomsDuringPeriod } from './symptom-log';
import { loadTemperature } from './temperature-log';
import { loadIllnessHint } from './illness-hint';

export async function buildSickPayload(userId: string, now: Date = new Date()) {
	const today = todayOsloKey(now);

	const [periods, state, symptoms, temperature, hint] = await Promise.all([
		listSickPeriods(userId),
		getSickState(userId, now),
		listSymptoms(userId),
		loadTemperature(userId).catch(() => null),
		// Forslaget er pynt på toppen: feiler det, skal ikke flaten feile.
		loadIllnessHint(userId, now).catch(() => null)
	]);

	const resolvedSymptoms = symptoms.map((s: Symptom) => {
		const resolved = resolveSymptom(s, today);
		return { ...resolved, text: describeSymptom(resolved) };
	});

	return {
		today,
		active: state.active,
		activePeriodId: state.period?.id ?? null,
		legacyFlagUntil: state.period ? null : state.until,
		periods: periods.map((p: SickPeriod) => {
			const resolved = resolveSickPeriod(p, today);
			return {
				...resolved,
				text: describeSickPeriod(resolved),
				// Forløpet: hva som var galt i denne perioden, ikke bare nå.
				symptomIds: symptomsDuringPeriod(symptoms, p, today).map((s) => s.id)
			};
		}),
		symptoms: resolvedSymptoms,
		/** Én linje om hva som er galt nå. Null når ingenting pågår. */
		symptomSummary: summarizeSymptoms(symptoms, today),
		temperature: temperature
			? {
					coreText: describeCoreTemperature(temperature.core),
					skinText: describeSkinTemperature(temperature.skin),
					latestCoreC: temperature.core.latest?.celsius ?? null,
					highestCoreC: temperature.core.highest?.celsius ?? null,
					skinDeviationC: temperature.skin.deviationC
				}
			: null,
		hint
	};
}

export type SickPayload = Awaited<ReturnType<typeof buildSickPayload>>;
