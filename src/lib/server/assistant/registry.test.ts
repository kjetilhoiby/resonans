import { describe, it, expect } from 'vitest';
import { ASSISTANT_TOOL_DEFINITIONS } from './tools';

/**
 * Integritetssjekk for hele det sammensatte verktøysettet (bespoke + delte + bil). Fanger
 * navnekollisjoner og feilformede definisjoner før de når modellen.
 */
describe('ASSISTANT_TOOL_DEFINITIONS', () => {
	it('har unike verktøynavn', () => {
		const names = ASSISTANT_TOOL_DEFINITIONS.map((d) => d.function.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('eksponerer både bil-ekspertise og bred chat-paritet', () => {
		const names = new Set(ASSISTANT_TOOL_DEFINITIONS.map((d) => d.function.name));
		// Bil/biltur
		expect(names).toContain('driving_route');
		expect(names).toContain('nearby_chargers');
		expect(names).toContain('query_tesla_vehicle');
		// Bred paritet
		for (const expected of ['query_economics', 'query_family', 'manage_training_program', 'weather_forecast', 'create_task']) {
			expect(names).toContain(expected);
		}
	});

	it('eksponerer quiz- og forteller-verktøyene', () => {
		const names = new Set(ASSISTANT_TOOL_DEFINITIONS.map((d) => d.function.name));
		for (const expected of ['trip_companions', 'quiz_questions', 'quiz_score']) {
			expect(names).toContain(expected);
		}
		for (const expected of ['story_start', 'story_scene', 'story_request', 'story_fill', 'story_end', 'story_state']) {
			expect(names).toContain(expected);
		}
	});

	it('hver definisjon er et gyldig function-tool med objekt-parametre', () => {
		for (const def of ASSISTANT_TOOL_DEFINITIONS) {
			expect(def.type).toBe('function');
			expect(typeof def.function.name).toBe('string');
			expect(def.function.parameters).toMatchObject({ type: 'object' });
		}
	});
});
