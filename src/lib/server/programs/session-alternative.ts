import { openai } from '$lib/server/openai';
import type { ProgramSessionDTO } from './types';
import type { ReadinessAlternative, ReadinessSignals, ReadinessState } from './readiness';
import { STRENGTH_EXERCISE_NAMES } from './constants';

const SYSTEM_PROMPT = `Du er Resonans-coach for treningsprogrammer. Brukeren har en planlagt økt i dag,
men tilstand-vurderingen sier at de bør gjøre en lettere variant. Du skal foreslå en
KONKRET erstatningsøkt som er enklere/kortere enn originalen, men fortsatt bidrar til progresjon
i programmet.

Regler:
- Returner JSON som matcher schemaet. Ingen forklaring utenom JSON.
- "kind" skal være "strength" eller "run" — samme som originalen.
- For løp: bytt intervaller/tempo til Z2 easy. Beholdt distanse eller redusert med 20-30%.
- For styrke (state=lett): samme øvelsesnavn, men reduser sets med 1 eller reps med 20%.
- For styrke (state=easy): bytt til mobility/light recovery — bruk ELT en av disse navnene:
  ${STRENGTH_EXERCISE_NAMES.join(', ')}, eller marker som rest (kind="rest").
- "name" på norsk, kort (under 30 tegn).
- "summary" 1 setning på norsk som forklarer hva økten består av.
- "rationale" 1 setning på norsk: hvorfor denne erstatningen er fornuftig akkurat nå.
- IKKE legg til økter som ikke fantes i originalen (ingen ny styrkeøvelse hvis original var løp).
`;

interface AlternativeInput {
	userId: string;
	originalSession: ProgramSessionDTO;
	state: Exclude<ReadinessState, 'klar' | 'rest'>;
	reasons: string[];
	signals: ReadinessSignals;
}

function buildUserPrompt(input: AlternativeInput): string {
	const { originalSession, state, reasons, signals } = input;
	const lines: string[] = [];
	lines.push(`State: ${state}`);
	lines.push(`Reasons: ${reasons.join('; ')}`);

	lines.push('');
	lines.push('Signaler:');
	if (signals.sleep.score !== null) lines.push(`- Søvn siste natt: ${signals.sleep.score}/100`);
	if (signals.sleep.nights.length > 1) {
		const prev = signals.sleep.nights[1];
		if (prev?.score !== null) lines.push(`- Søvn forrige natt: ${prev?.score ?? '?'}/100`);
	}
	if (signals.egenfrekvens.level !== null) {
		lines.push(`- Egenfrekvens: ${signals.egenfrekvens.level}/5 (balanse ${signals.egenfrekvens.balance})`);
	}
	if (signals.crunch.active) lines.push(`- Crunch-periode aktiv`);
	if (signals.trip.active && signals.trip.destination) {
		lines.push(`- På reise: ${signals.trip.destination}`);
	}

	lines.push('');
	lines.push('Original økt:');
	lines.push(`Kind: ${originalSession.kind}`);
	lines.push(`Name: ${originalSession.name}`);
	if (originalSession.kind === 'run' && originalSession.plannedRun) {
		lines.push(`Run type: ${originalSession.plannedRun.runType}`);
		if (originalSession.plannedRun.targetDistanceMeters) {
			lines.push(`Distance: ${originalSession.plannedRun.targetDistanceMeters}m`);
		}
		if (originalSession.plannedRun.targetDurationSeconds) {
			lines.push(`Duration: ${originalSession.plannedRun.targetDurationSeconds}s`);
		}
		if (originalSession.plannedRun.paceHintSecPerKm) {
			lines.push(`Pace hint: ${originalSession.plannedRun.paceHintSecPerKm}s/km`);
		}
		if (originalSession.plannedRun.intervals && originalSession.plannedRun.intervals.length > 0) {
			lines.push(`Intervals: ${JSON.stringify(originalSession.plannedRun.intervals)}`);
		}
	}
	if (originalSession.kind === 'strength' && originalSession.plannedExercises) {
		lines.push(`Exercises:`);
		for (const ex of originalSession.plannedExercises) {
			const target = ex.repsTarget ? `${ex.repsTarget} reps` : `${ex.durationSecondsTarget}s`;
			lines.push(`  - ${ex.exerciseName}: ${ex.sets} × ${target}`);
		}
	}

	lines.push('');
	lines.push('Returner JSON som matcher:');
	lines.push(`{
  "kind": "strength" | "run" | "rest",
  "name": "string",
  "summary": "string",
  "plannedRun": { "runType": "easy"|"tempo"|"intervals"|"long", "targetDistanceMeters"?: number, "targetDurationSeconds"?: number, "paceHintSecPerKm"?: number, "hrZoneHint"?: string, "notes"?: string },
  "plannedExercises": [ { "exerciseName": "string", "sets": number, "repsTarget"?: number, "durationSecondsTarget"?: number, "notes"?: string } ],
  "rationale": "string"
}`);

	return lines.join('\n');
}

export async function generateSessionAlternative(
	input: AlternativeInput
): Promise<ReadinessAlternative> {
	// Fallback hvis OpenAI-kallet feiler — bedre å levere en regelbasert variant enn å krasje.
	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: buildUserPrompt(input) }
			],
			temperature: 0.2,
			response_format: { type: 'json_object' }
		});
		const content = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(content) as ReadinessAlternative;
		if (parsed.kind && parsed.name && parsed.summary) {
			return parsed;
		}
		console.warn('[session-alternative] AI response missing required fields, falling back');
	} catch (error) {
		console.error('[session-alternative] AI generation failed, using rule fallback:', error);
	}
	return ruleBasedAlternative(input);
}

/**
 * Regelbasert fallback hvis AI ikke svarer. Bedre å gi noe brukbart enn ingenting.
 */
function ruleBasedAlternative(input: AlternativeInput): ReadinessAlternative {
	const { originalSession, state, reasons } = input;
	const rationale = `${reasons.join(', ')} — derfor lettere variant i dag.`;

	if (originalSession.kind === 'run') {
		const orig = originalSession.plannedRun;
		const origMeters = orig?.targetDistanceMeters ?? 6000;
		const reducedMeters =
			state === 'easy' ? Math.max(3000, Math.round(origMeters * 0.5)) : Math.round(origMeters * 0.7);
		return {
			kind: 'run',
			name: state === 'easy' ? 'Easy 30 min' : 'Easy løp',
			summary:
				state === 'easy'
					? '30 min rolig løp / valgfri tur. Z2 puls.'
					: `${(reducedMeters / 1000).toFixed(1)} km rolig (Z2). Hopp over intervaller/tempo.`,
			plannedRun: {
				runType: 'easy',
				targetDistanceMeters: state === 'easy' ? undefined : reducedMeters,
				targetDurationSeconds: state === 'easy' ? 30 * 60 : undefined,
				hrZoneHint: 'Z2'
			},
			rationale
		};
	}

	// Styrke
	if (state === 'easy') {
		return {
			kind: 'rest',
			name: 'Mobility / hvile',
			summary: '20 min mobility eller en rolig tur. Drop styrke i dag.',
			rationale
		};
	}
	const reduced = (originalSession.plannedExercises ?? []).map((ex) => ({
		exerciseName: ex.exerciseName,
		sets: Math.max(1, ex.sets - 1),
		repsTarget: ex.repsTarget ? Math.max(1, Math.round(ex.repsTarget * 0.8)) : undefined,
		durationSecondsTarget: ex.durationSecondsTarget
			? Math.max(10, Math.round(ex.durationSecondsTarget * 0.8))
			: undefined,
		notes: 'Reduserte sett — stopp ved RPE 7.'
	}));
	return {
		kind: 'strength',
		name: 'Lett styrke',
		summary: 'Samme øvelser, men 1 sett mindre og 20 % færre reps.',
		plannedExercises: reduced,
		rationale
	};
}
