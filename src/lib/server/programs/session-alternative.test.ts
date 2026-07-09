import { describe, it, expect } from 'vitest';
import { normalizeAlternative } from './session-alternative';
import type { ReadinessAlternative } from './readiness';

/**
 * Ekko dekoder alternative.plannedExercises som samme PlannedExercise-type som
 * øktene, der id og order er påkrevd — normaliseringen skal garantere begge.
 */

describe('normalizeAlternative', () => {
	it('syntetiserer id og order på øvelser som mangler dem', () => {
		const alternative: ReadinessAlternative = {
			kind: 'strength',
			name: 'Lett styrkeøkt',
			summary: 'En lett styrkeøkt med redusert volum.',
			rationale: 'Egenfrekvens 2/5 — derfor lettere variant i dag.',
			plannedExercises: [
				{ exerciseName: 'Armhevinger', sets: 2, repsTarget: 4 },
				{ exerciseName: 'Planke', sets: 2, durationSecondsTarget: 25 }
			]
		};

		expect(normalizeAlternative(alternative).plannedExercises).toEqual([
			{ id: 'alt-e1', order: 1, exerciseName: 'Armhevinger', sets: 2, repsTarget: 4 },
			{ id: 'alt-e2', order: 2, exerciseName: 'Planke', sets: 2, durationSecondsTarget: 25 }
		]);
	});

	it('beholder eksisterende id og order', () => {
		const alternative: ReadinessAlternative = {
			kind: 'strength',
			name: 'Lett styrke',
			summary: 'Samme øvelser, redusert.',
			rationale: 'Søvn 48.',
			plannedExercises: [{ id: 'x1', order: 5, exerciseName: 'Knebøy', sets: 3 }]
		};

		expect(normalizeAlternative(alternative).plannedExercises).toEqual([
			{ id: 'x1', order: 5, exerciseName: 'Knebøy', sets: 3 }
		]);
	});

	it('lar alternativer uten øvelser (løp/hvile) passere uendret', () => {
		const alternative: ReadinessAlternative = {
			kind: 'run',
			name: 'Easy 30 min',
			summary: '30 min rolig løp.',
			rationale: 'Søvn 48.',
			plannedRun: { runType: 'easy', targetDurationSeconds: 1800 }
		};

		expect(normalizeAlternative(alternative)).toBe(alternative);
	});
});
