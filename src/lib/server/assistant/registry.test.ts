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

	/**
	 * Undertemaenes beregnede lag. Uten disse svarer stemmen på belastning med rå
	 * øktantall fra `query_sensor_data` — feilen som utløste
	 * `docs/changelog/2026-08-07-domenedata-til-assistenten.md`.
	 */
	it('eksponerer helse-undertemaenes egne leseverktøy', () => {
		const names = new Set(ASSISTANT_TOOL_DEFINITIONS.map((d) => d.function.name));
		for (const expected of ['query_training', 'query_weight', 'query_sleep', 'query_egenfrekvens']) {
			expect(names).toContain(expected);
		}
	});

	it('skjuler userId for modellen på de nye leseverktøyene', () => {
		// `userId` injiseres server-side; kommer den med i skjemaet, kan modellen sette den.
		for (const name of ['query_training', 'query_weight', 'query_sleep', 'query_egenfrekvens']) {
			const def = ASSISTANT_TOOL_DEFINITIONS.find((d) => d.function.name === name);
			const properties = (def?.function.parameters as { properties?: Record<string, unknown> })?.properties ?? {};
			expect(Object.keys(properties)).not.toContain('userId');
			// Og queryType skal være der, ellers får modellen ingen måte å velge utsnitt.
			expect(Object.keys(properties)).toContain('queryType');
		}
	});

	it('eksponerer quiz- og forteller-verktøyene', () => {
		const names = new Set(ASSISTANT_TOOL_DEFINITIONS.map((d) => d.function.name));
		for (const expected of ['trip_companions', 'quiz_score']) {
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
