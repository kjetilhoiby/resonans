import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/openai', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/openai')>('$lib/server/openai');
	return { ...actual, openai: {} };
});

import { buildModularSystemPrompt, BASE_PROMPT, DOMAIN_PROMPTS } from './index';
import type { ChatRoutingDecision } from '../chat-router';

function routing(overrides: Partial<ChatRoutingDecision> = {}): ChatRoutingDecision {
	return {
		domains: ['general'],
		skills: ['general_chat'],
		focusModules: [],
		hints: [],
		mode: 'conversation',
		...overrides
	};
}

describe('buildModularSystemPrompt', () => {
	it('inkluderer alltid BASE_PROMPT', () => {
		const prompt = buildModularSystemPrompt(routing());
		expect(prompt).toContain(BASE_PROMPT);
	});

	it('legger til domeneprompt for health', () => {
		const prompt = buildModularSystemPrompt(routing({ domains: ['health'] }));
		expect(prompt).toContain(DOMAIN_PROMPTS.health);
	});

	it('legger til domeneprompt for economics', () => {
		const prompt = buildModularSystemPrompt(routing({ domains: ['economics'] }));
		expect(prompt).toContain(DOMAIN_PROMPTS.economics);
	});

	it('legger til flere domeneprompts', () => {
		const prompt = buildModularSystemPrompt(routing({ domains: ['health', 'food'] }));
		expect(prompt).toContain(DOMAIN_PROMPTS.health);
		expect(prompt).toContain(DOMAIN_PROMPTS.food);
	});

	it('legger ikke til domeneprompt for general', () => {
		const prompt = buildModularSystemPrompt(routing({ domains: ['general'] }));
		const withoutBase = prompt.replace(BASE_PROMPT, '');
		expect(withoutBase).not.toContain('DOMAIN_PROMPTS');
	});

	it('inkluderer domainHints', () => {
		const prompt = buildModularSystemPrompt(routing({ domainHints: ['Vis vektdata'] }));
		expect(prompt).toContain('Vis vektdata');
		expect(prompt).toContain('FOR DENNE MELDINGEN');
	});

	it('inkluderer skill-hints', () => {
		const prompt = buildModularSystemPrompt(routing({ hints: ['Bruk web_search for ferske fakta'] }));
		expect(prompt).toContain('web_search');
		expect(prompt).toContain('AKTIVERTE SKILLS');
	});

	it('utelater domainHints-seksjon når tom', () => {
		const prompt = buildModularSystemPrompt(routing());
		expect(prompt).not.toContain('FOR DENNE MELDINGEN');
	});

	it('utelater skills-seksjon når tom', () => {
		const prompt = buildModularSystemPrompt(routing({ hints: [] }));
		expect(prompt).not.toContain('AKTIVERTE SKILLS');
	});

	it('returnerer en string med fornuftig lengde', () => {
		const prompt = buildModularSystemPrompt(routing({ domains: ['health', 'economics', 'food'] }));
		expect(prompt.length).toBeGreaterThan(BASE_PROMPT.length);
	});
});
