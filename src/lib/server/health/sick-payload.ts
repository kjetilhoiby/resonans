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
import { getSickState, lastSickLevel, listSickPeriods, todayOsloKey } from './sick-log';
import { loadSleepHeartRate } from './nightly-physiology';
import { listSymptoms, symptomsDuringPeriod } from './symptom-log';
import { loadTemperature } from './temperature-log';
import { loadIllnessHint } from './illness-hint';

export async function buildSickPayload(userId: string, now: Date = new Date()) {
	const today = todayOsloKey(now);

	const [periods, state, symptoms, temperature, hint, previousLevel, sleepHr] = await Promise.all([
		listSickPeriods(userId),
		getSickState(userId, now),
		listSymptoms(userId),
		loadTemperature(userId).catch(() => null),
		// Forslaget er pynt på toppen: feiler det, skal ikke flaten feile.
		loadIllnessHint(userId, now).catch(() => null),
		lastSickLevel(userId, now).catch(() => null),
		loadSleepHeartRate(userId, 30).catch(() => null)
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
		hint,
		/**
		 * Alt sykeinnsjekk-flyten trenger, ferdig formulert.
		 *
		 * `signals` er SETNINGER fra domenelaget, aldri rå verdier — flaten,
		 * flyten og helsechatten skal si det samme, og et rått tall her ville
		 * invitert flyten til å finne sine egne ord. Hudtemperatur oppgis som
		 * avvik fordi det absolutte håndleddstallet ikke betyr noe.
		 */
		checkin: {
			previousLevel,
			signals: buildSignals(temperature, sleepHr)
		}
	};
}

function buildSignals(
	temperature: Awaited<ReturnType<typeof loadTemperature>> | null,
	sleepHr: Awaited<ReturnType<typeof loadSleepHeartRate>> | null
): string[] {
	const signals: string[] = [];

	// Sovepuls som AVVIK fra egen baseline, som Søvn-flaten gjør. Uten baseline
	// sies ingenting: et absolutt hvilepulstall uten sammenligning er ikke et
	// signal, bare et tall.
	if (sleepHr?.deviationBpm != null && sleepHr.band !== 'ukjent') {
		const d = sleepHr.deviationBpm;
		if (d === 0) signals.push('Sovepuls som vanlig');
		else
			signals.push(
				`Sovepuls ${Math.abs(d)} ${Math.abs(d) === 1 ? 'slag' : 'slag'} ${d > 0 ? 'over' : 'under'} snittet`
			);
	}

	const core = temperature ? describeCoreTemperature(temperature.core) : null;
	if (core) signals.push(`Termometer ${core}`);
	const skin = temperature ? describeSkinTemperature(temperature.skin) : null;
	if (skin) signals.push(skin);

	return signals;
}

export type SickPayload = Awaited<ReturnType<typeof buildSickPayload>>;
