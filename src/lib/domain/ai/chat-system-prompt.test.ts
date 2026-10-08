import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleSystemPrompt, SYSTEM_PROMPT_BLOCKS } from './chat-system-prompt';

describe('assembleSystemPrompt', () => {
	it('limer blokkene i fast rekkefølge, med tom linje bare etter prefikset', () => {
		const { content } = assembleSystemPrompt({ health: '[H]', base: 'BASE', prefix: 'PRE', memory: '\n\nMINNE' });
		expect(content).toBe('PRE\n\nBASE\n\nMINNE[H]');
	});

	it('uten prefiks begynner meldingen med grunnprompten', () => {
		expect(assembleSystemPrompt({ base: 'BASE' }).content).toBe('BASE');
	});

	it('anatomien teller hver blokk, også de tomme, med de lagrede navnene', () => {
		const { parts } = assembleSystemPrompt({ prefix: 'PRE', base: 'BASE' });
		expect(parts).toHaveLength(SYSTEM_PROMPT_BLOCKS.length);
		expect(parts.find((p) => p.name === 'prefiks')?.chars).toBe(5);
		expect(parts.find((p) => p.name === 'grunnprompt')?.chars).toBe(4);
		expect(parts.find((p) => p.name === 'helse')?.chars).toBe(0);
	});

	it('anatomien summerer til meldingens lengde', () => {
		const blocks = Object.fromEntries(SYSTEM_PROMPT_BLOCKS.map((b, i) => [b, 'x'.repeat(i + 1)]));
		const { content, parts } = assembleSystemPrompt(blocks);
		expect(parts.reduce((sum, p) => sum + p.chars, 0)).toBe(content.length);
	});
});

// Ruta skal ikke lime selv ved siden av: da ville en ny blokk nå modellen uten
// å stå i anatomien, eller omvendt.
describe('chat-ruta bruker den', () => {
	it('setter sammen systemmeldingen med assembleSystemPrompt', () => {
		const route = readFileSync(resolve(process.cwd(), 'src/routes/api/chat/+server.ts'), 'utf8');
		expect(route).toContain('assembleSystemPrompt({');
		expect(route).not.toContain('promptPrefix + systemPrompt');
	});
});
