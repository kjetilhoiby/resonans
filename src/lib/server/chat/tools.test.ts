import { describe, expect, it } from 'vitest';
import { CHAT_TOOLS } from './tools';

/**
 * `chat-tools.json` er verktøylista som ren data, for Stemmegaffel. Se filhodet
 * i `tools.ts`. Feiler den første testen, er lista endret uten at fila er
 * skrevet på nytt: kjør `npx vitest run src/lib/server/chat/tools.test.ts -u`
 * og commit begge.
 */
describe('chat-verktøyene', () => {
	it('chat-tools.json er lik lista', async () => {
		await expect(`${JSON.stringify(CHAT_TOOLS, null, '\t')}\n`).toMatchFileSnapshot('./chat-tools.json');
	});

	it('hvert verktøy har et unikt navn, en beskrivelse og et objektskjema', () => {
		const names = CHAT_TOOLS.map((t) => t.function.name);
		expect(new Set(names).size).toBe(names.length);
		for (const tool of CHAT_TOOLS) {
			expect(tool.type, tool.function.name).toBe('function');
			expect(tool.function.description, tool.function.name).toBeTruthy();
			expect((tool.function.parameters as { type?: string }).type, tool.function.name).toBe('object');
		}
	});

	// JSON-fila må bære alt modellen ser. En zod-verdi eller en funksjon i et
	// skjema ville forsvunnet stille i `JSON.stringify`.
	it('lista overlever en rundtur gjennom JSON uendret', () => {
		expect(JSON.parse(JSON.stringify(CHAT_TOOLS))).toEqual(CHAT_TOOLS);
	});
});
