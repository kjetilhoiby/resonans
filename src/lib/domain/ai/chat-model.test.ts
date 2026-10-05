import { describe, it, expect } from 'vitest';
import {
	chooseChatModel,
	completionSizing,
	isLegacyChatModelMode,
	isReasoningChatModel,
	resolveDefaultChatModel,
	resolveReasoningEffort,
	resolveVerbosity,
	shouldFallBackToChatModel,
	DEFAULT_CHAT_MODEL,
	FALLBACK_CHAT_MODEL,
	REASONING_TOKEN_FLOOR
} from './chat-model';

const base = { hasImage: false, userInput: 'hvordan gikk uka?' } as const;

describe('chooseChatModel', () => {
	it('bruker standardmodellen når ingenting er valgt og ingenting er konfigurert', () => {
		expect(chooseChatModel({ ...base, phase: 'initial' })).toEqual({
			model: DEFAULT_CHAT_MODEL,
			reason: 'default_initial'
		});
	});

	it('bruker SAMME modell i runden etter verktøykallene', () => {
		const decision = chooseChatModel({ ...base, phase: 'followup', toolCallCount: 1, toolRound: 0 });
		expect(decision.model).toBe(DEFAULT_CHAT_MODEL);
	});

	it('brukerens valg gjelder også etter verktøyene — før skrev mini svaret der', () => {
		const decision = chooseChatModel({ ...base, phase: 'followup', preferredModel: 'gpt-4.1' });
		expect(decision).toEqual({ model: 'gpt-4.1', reason: 'user_preferred_model' });
	});

	it('«auto» fra modellknappen er ikke et valg', () => {
		expect(chooseChatModel({ ...base, phase: 'initial', preferredModel: 'auto' }).model).toBe(DEFAULT_CHAT_MODEL);
	});

	it('konfigurert standard vinner over defaulten', () => {
		expect(chooseChatModel({ ...base, phase: 'initial', configuredDefault: ' gpt-4.1 ' }).model).toBe('gpt-4.1');
	});

	it('bilder går til standardmodellen, ikke til en egen bildemodell', () => {
		expect(chooseChatModel({ ...base, phase: 'initial', hasImage: true }).model).toBe(DEFAULT_CHAT_MODEL);
	});

	describe('legacy', () => {
		const legacy = { configuredDefault: 'legacy' } as const;

		it('gir den gamle hurtigstien tilbake', () => {
			expect(chooseChatModel({ ...base, ...legacy, phase: 'initial' })).toEqual({
				model: 'gpt-4o-mini',
				reason: 'default_fast_path'
			});
		});

		it('løfter planleggingsspørsmål til gpt-4o, som før', () => {
			expect(chooseChatModel({ ...base, ...legacy, phase: 'initial', userInput: 'lag en plan for uka' }).model).toBe('gpt-4o');
		});

		it('bilder til gpt-4o, som før', () => {
			expect(chooseChatModel({ ...base, ...legacy, phase: 'initial', hasImage: true }).model).toBe('gpt-4o');
		});

		it('brukerens valg vinner også i legacy', () => {
			expect(chooseChatModel({ ...base, ...legacy, phase: 'followup', preferredModel: 'gpt-5.4' }).model).toBe('gpt-5.4');
		});
	});
});

describe('resolveDefaultChatModel / isLegacyChatModelMode', () => {
	it('tom eller manglende verdi gir defaulten', () => {
		expect(resolveDefaultChatModel(undefined)).toBe(DEFAULT_CHAT_MODEL);
		expect(resolveDefaultChatModel('  ')).toBe(DEFAULT_CHAT_MODEL);
	});

	it('kjenner igjen legacy', () => {
		expect(isLegacyChatModelMode('legacy')).toBe(true);
		expect(isLegacyChatModelMode(undefined)).toBe(false);
	});
});

describe('completionSizing', () => {
	it('reasoning-modell: ingen temperature, max_completion_tokens med gulv', () => {
		expect(completionSizing('gpt-5.4', { temperature: 0.8, maxTokens: 1000 })).toEqual({
			max_completion_tokens: REASONING_TOKEN_FLOOR,
			reasoning_effort: 'low',
			verbosity: 'low'
		});
	});

	it('reasoning-modell: et tak over gulvet beholdes, og innsats og ordrikhet kan overstyres', () => {
		const sizing = completionSizing('gpt-5.4', {
			temperature: 0.8,
			maxTokens: 6000,
			reasoningEffort: 'medium',
			verbosity: 'medium'
		});
		expect(sizing).toEqual({ max_completion_tokens: 6000, reasoning_effort: 'medium', verbosity: 'medium' });
	});

	it('vanlig modell: temperature og max_tokens som før', () => {
		expect(completionSizing('gpt-4o', { temperature: 0.3, maxTokens: 1000 })).toEqual({
			temperature: 0.3,
			max_tokens: 1000
		});
	});

	it('gjenkjenner modellfamiliene', () => {
		expect(isReasoningChatModel('gpt-5.4')).toBe(true);
		expect(isReasoningChatModel('o3-mini')).toBe(true);
		expect(isReasoningChatModel('gpt-4o')).toBe(false);
		expect(isReasoningChatModel('gpt-4.1')).toBe(false);
	});
});

describe('resolveReasoningEffort', () => {
	it('default er low', () => {
		expect(resolveReasoningEffort(undefined)).toBe('low');
	});

	it('godtar kjente verdier, avviser ukjente', () => {
		expect(resolveReasoningEffort('MEDIUM')).toBe('medium');
		expect(resolveReasoningEffort('ekstrem')).toBe('low');
	});
});

describe('resolveVerbosity', () => {
	it('default er low', () => {
		expect(resolveVerbosity(undefined)).toBe('low');
	});

	it('godtar kjente verdier, avviser ukjente', () => {
		expect(resolveVerbosity('high')).toBe('high');
		expect(resolveVerbosity('pratsom')).toBe('low');
	});
});

describe('shouldFallBackToChatModel', () => {
	it('faller tilbake når OpenAI avviser forespørselen', () => {
		expect(shouldFallBackToChatModel('gpt-5.4', 400)).toBe(true);
		expect(shouldFallBackToChatModel('gpt-5.4', 404)).toBe(true);
	});

	it('ikke ved rate limit eller nettverksfeil — det ville doblet trykket', () => {
		expect(shouldFallBackToChatModel('gpt-5.4', 429)).toBe(false);
		expect(shouldFallBackToChatModel('gpt-5.4', undefined)).toBe(false);
	});

	it('aldri fra reserven til seg selv', () => {
		expect(shouldFallBackToChatModel(FALLBACK_CHAT_MODEL, 400)).toBe(false);
	});
});
