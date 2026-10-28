import { describe, it, expect } from 'vitest';
import { MCP_TOOLS, toolAnnotations } from './mcp-tools';
import { toolList } from './mcp-server';

describe('MCP_TOOLS', () => {
	const names = MCP_TOOLS.map((tool) => tool.definition.function.name);

	it('har unike navn og dekker de sentrale domenene', () => {
		expect(new Set(names).size).toBe(names.length);
		for (const expected of ['query_training', 'query_weight', 'query_economics', 'create_task', 'weather_forecast']) {
			expect(names).toContain(expected);
		}
	});

	it('holder Ekkos quiz og forteller utenfor', () => {
		expect(names.some((name) => name.startsWith('story_') || name.startsWith('quiz_'))).toBe(false);
		expect(names).not.toContain('trip_companions');
	});

	// Navnene må passe MCP-klientenes mønster, ellers avvises hele lista.
	it('har navn klientene godtar', () => {
		for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
	});
});

describe('toolList', () => {
	it('gir hvert verktøy et objekt-skjema uten userId', () => {
		for (const tool of toolList()) {
			expect(tool.inputSchema.type).toBe('object');
			const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
			expect(properties).not.toHaveProperty('userId');
		}
	});
});

describe('toolAnnotations', () => {
	it('merker lese-verktøy som read-only', () => {
		expect(toolAnnotations('query_weight')).toMatchObject({ readOnlyHint: true, destructiveHint: false });
		expect(toolAnnotations('programToday').readOnlyHint).toBe(true);
	});

	it('merker manage_* som destruktive', () => {
		expect(toolAnnotations('manage_weight_measurement')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
	});

	it('fange-handlinger skriver, men sletter ikke', () => {
		expect(toolAnnotations('create_task')).toMatchObject({ readOnlyHint: false, destructiveHint: false });
	});

	it('eksterne oppslag er open-world', () => {
		expect(toolAnnotations('weather_forecast').openWorldHint).toBe(true);
		expect(toolAnnotations('query_weight').openWorldHint).toBe(false);
	});
});
