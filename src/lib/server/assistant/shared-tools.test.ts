import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { adaptSharedTool } from './shared-tools';

/**
 * Adapteren eksponerer delte chat-verktøy for assistenten: zod → JSON-schema, `userId` skjult for
 * modellen men injisert ved kall. Disse testene låser den kontrakten.
 */
describe('adaptSharedTool', () => {
	const fakeTool = {
		name: 'demo_tool',
		description: 'Et testverktøy',
		parameters: z.object({
			userId: z.string(),
			action: z.enum(['les', 'skriv']).describe('hva'),
			limit: z.number().optional()
		}),
		execute: async (args: Record<string, unknown>) => ({ echoed: args })
	};

	it('konverterer zod til JSON-schema og skjuler userId for modellen', () => {
		const adapted = adaptSharedTool(fakeTool);
		const params = adapted.definition.function.parameters as {
			properties: Record<string, unknown>;
			required?: string[];
		};
		expect(adapted.definition.function.name).toBe('demo_tool');
		expect(Object.keys(params.properties)).toEqual(['action', 'limit']);
		expect(params.properties).not.toHaveProperty('userId');
		expect(params.required).toEqual(['action']);
	});

	it('injiserer userId (og statiske inject-verdier) ved kall', async () => {
		const adapted = adaptSharedTool(fakeTool, { inject: { source: 'test' } });
		const result = (await adapted.run('user-1', { action: 'les' })) as { echoed: Record<string, unknown> };
		expect(result.echoed).toEqual({ userId: 'user-1', source: 'test', action: 'les' });
	});

	it('bruker eksplisitt parametersSchema for verktøy uten zod-parameters', () => {
		const executeOnly = { name: 'bar', execute: async () => ({}) };
		const schema = { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] };
		const adapted = adaptSharedTool(executeOnly, { description: 'B', parametersSchema: schema });
		expect(adapted.definition.function.parameters).toEqual(schema);
		expect(adapted.definition.function.description).toBe('B');
	});

	it('faller tilbake til tomt objekt-skjema når parameters mangler', () => {
		const adapted = adaptSharedTool({ name: 'baz', execute: async () => ({}) });
		expect(adapted.definition.function.parameters).toEqual({ type: 'object', properties: {} });
	});
});
