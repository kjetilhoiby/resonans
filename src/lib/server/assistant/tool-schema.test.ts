import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openAiFunctionDefinition } from './tool-schema';
import { createGoalTool } from '$lib/ai/tools/create-goal';
import { queryWeightTool } from '$lib/ai/tools/query-weight';

const CHAT_ROUTE = fileURLToPath(new URL('../../../routes/api/chat/+server.ts', import.meta.url));

describe('openAiFunctionDefinition', () => {
	it('tar med parametrene fra verktøymodulen', () => {
		const definition = openAiFunctionDefinition(createGoalTool);
		const properties = (definition.function.parameters as { properties: Record<string, unknown> })
			.properties;

		// Feltene som ble lagt til i august 2026, og som web-chatten ikke så fordi
		// skjemaet var skrevet av for hånd der.
		expect(properties).toHaveProperty('targetWeightKg');
		expect(properties).toHaveProperty('startValue');
		expect(properties).toHaveProperty('metricId');
	});

	it('skjuler userId — den injiseres av endepunktet, aldri av modellen', () => {
		const definition = openAiFunctionDefinition(createGoalTool);
		const properties = (definition.function.parameters as { properties: Record<string, unknown> })
			.properties;

		expect(properties).not.toHaveProperty('userId');
	});

	it('bruker beskrivelsen fra modulen', () => {
		expect(openAiFunctionDefinition(createGoalTool).function.description).toContain('MÅLVEKTEN');
		expect(openAiFunctionDefinition(queryWeightTool).function.description).toContain("'periods'");
	});

	it('tåler verktøy uten zod-parametre', () => {
		const definition = openAiFunctionDefinition({ name: 'tomt' });
		expect(definition.function.parameters).toEqual({ type: 'object', properties: {} });
	});
});

/**
 * Vakt mot at kopien kommer tilbake.
 *
 * Chat-endepunktet hadde et håndskrevet skjema for `create_goal`, og det drev fra
 * verktøymodulen: `targetWeightKg` og «oppgi MÅLVEKTEN» fantes i modulen mens kopien
 * fortsatt sa «-3 for kg ned». Modellen fulgte kopien. En tekstvakt er nok her —
 * feilen er at navnet står som en literal ved siden av et eget `parameters`-objekt.
 */
describe('chat-endepunktet skriver ikke skjemaene av', () => {
	const source = readFileSync(CHAT_ROUTE, 'utf8');

	for (const name of ['create_goal', 'query_weight']) {
		it(`henter ${name} fra verktøymodulen`, () => {
			expect(source).not.toContain(`name: '${name}',`);
			expect(source).toContain('openAiFunctionDefinition(');
		});
	}
});
