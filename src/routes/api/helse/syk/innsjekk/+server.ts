import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { endSickPeriod, getSickState, recordSickLevel } from '$lib/server/health/sick-log';
import { endSymptom, listSymptoms, saveSymptom } from '$lib/server/health/symptom-log';
import { buildSickPayload } from '$lib/server/health/sick-payload';
import {
	SICK_LEVEL_MAX,
	SICK_LEVEL_MIN,
	SICK_LEVEL_RECOVERED
} from '$lib/domain/health/sick-checkin';
import { SYMPTOM_SEVERITIES, type SymptomSeverity } from '$lib/domain/health/symptoms';

/**
 * Hele sykeinnsjekken i ett kall — nivå, symptomretninger, nytt symptom, notat.
 *
 * Én skrivevei framfor fire kall fra flyten: halvveis lagret er verre enn ikke
 * lagret, og en flyt som feiler på steg tre skal ikke etterlate nivået skrevet
 * og symptomene urørt.
 *
 * **Retningene skrives gjennom `saveSymptom`/`endSymptom`**, altså de samme
 * funksjonene kortet på Helse bruker. En egen oppdateringssti her ville kunnet
 * drive fra dem.
 */

/** «bedre»/«verre» flytter alvorligheten ett hakk; «over» avslutter symptomet. */
function shift(current: SymptomSeverity, direction: string): SymptomSeverity {
	const i = SYMPTOM_SEVERITIES.indexOf(current);
	if (direction === 'bedre') return SYMPTOM_SEVERITIES[Math.max(0, i - 1)];
	if (direction === 'verre') return SYMPTOM_SEVERITIES[Math.min(SYMPTOM_SEVERITIES.length - 1, i + 1)];
	return current;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const body = await request.json().catch(() => ({}));

	const rawLevel = Number(body?.level);
	if (!Number.isInteger(rawLevel) || rawLevel < SICK_LEVEL_MIN || rawLevel > SICK_LEVEL_MAX) {
		return json({ error: `Nivået må være et heltall ${SICK_LEVEL_MIN}–${SICK_LEVEL_MAX}.` }, { status: 400 });
	}
	const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;

	await recordSickLevel(userId, rawLevel, { note });

	// Symptomretningene, mot de symptomene som FAKTISK finnes: flyten sender
	// id-er den fikk ved åpning, og et symptom kan være avsluttet i mellomtiden.
	const existing = await listSymptoms(userId);
	const byId = new Map(existing.map((s) => [s.id, s]));
	const decisions = Array.isArray(body?.symptoms) ? body.symptoms : [];

	for (const entry of decisions) {
		const symptom = byId.get(entry?.id);
		if (!symptom) continue;
		const direction = typeof entry?.direction === 'string' ? entry.direction : 'uendret';

		if (direction === 'over') {
			await endSymptom(userId, symptom.id);
			continue;
		}
		const severity = shift(symptom.severity, direction);
		if (severity === symptom.severity) continue;
		await saveSymptom(userId, { ...symptom, severity });
	}

	const newLabel = typeof body?.newSymptom === 'string' ? body.newSymptom.trim() : '';
	let newSymptomError: string | null = null;
	if (newLabel) {
		const created = await saveSymptom(userId, { label: newLabel });
		// Et avvist symptom skal ikke velte innsjekken — nivået er alt skrevet.
		// Men feilen sies, framfor å forsvinne.
		if (!created.ok) newSymptomError = created.error;
	}

	/**
	 * «Frisk» avslutter perioden.
	 *
	 * Sier du 5, er det unaturlig å måtte finne kortet på Helse for å bli
	 * friskmeldt — innsjekken er stedet forløpet faktisk ender. Sluttdatoen er
	 * `endSickPeriod` sin beslutning (gårsdagen), ikke vår.
	 */
	let recovered = false;
	if (rawLevel >= SICK_LEVEL_RECOVERED) {
		const state = await getSickState(userId);
		if (state.period) {
			const ended = await endSickPeriod(userId, state.period.id);
			recovered = ended.ok;
		}
	}

	return json({ ...(await buildSickPayload(userId)), recovered, newSymptomError });
};
