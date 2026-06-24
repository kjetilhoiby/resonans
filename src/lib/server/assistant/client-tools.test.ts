import { describe, it, expect } from 'vitest';
import { CLIENT_TOOL_DEFINITIONS, CLIENT_TOOL_NAMES } from './client-tools';
import { ASSISTANT_TOOL_DEFINITIONS } from './tools';

/**
 * Klient-verktøyene (on-device) er en egen allow-list som tilbys modellen ved siden av
 * server-verktøyene, men aldri kjøres server-side. Testene låser allow-listen og at den ikke
 * overlapper med server-registeret (ellers ville et navn både blitt kjørt server-side OG rutet
 * til klienten).
 */
describe('klient-verktøy allow-list', () => {
	it('inneholder nøyaktig de fire avtalte verktøyene', () => {
		expect([...CLIENT_TOOL_NAMES].sort()).toEqual(
			['driveDistance', 'nearestPlace', 'resolvePlace', 'sendToCar'].sort()
		);
	});

	it('har gyldige function-tool-definisjoner med kun string-parametre', () => {
		for (const def of CLIENT_TOOL_DEFINITIONS) {
			expect(def.type).toBe('function');
			const params = def.function.parameters as {
				properties?: Record<string, { type?: string }>;
			};
			for (const prop of Object.values(params.properties ?? {})) {
				expect(prop.type).toBe('string');
			}
		}
	});

	it('overlapper ikke med server-verktøyene', () => {
		const serverNames = new Set(ASSISTANT_TOOL_DEFINITIONS.map((d) => d.function.name));
		for (const name of CLIENT_TOOL_NAMES) {
			expect(serverNames.has(name)).toBe(false);
		}
	});
});
