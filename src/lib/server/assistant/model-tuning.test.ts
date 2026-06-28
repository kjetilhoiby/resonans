import { describe, it, expect } from 'vitest';
import { isReasoningModel, completionTuning } from './assistant';

/**
 * Vakt for parameter-formatet mot OpenAI: GPT-4o tar `max_tokens` + `temperature`, mens GPT-5/
 * o-serien krever `max_completion_tokens` og ingen egendefinert temperatur. Feil her gir 400 fra
 * OpenAI (→ 502 mot frontend), så skillet må holde.
 */
describe('isReasoningModel', () => {
	it('kjenner igjen GPT-5- og o-serien', () => {
		expect(isReasoningModel('gpt-5.5')).toBe(true);
		expect(isReasoningModel('gpt-5.5-pro')).toBe(true);
		expect(isReasoningModel('gpt-5.4')).toBe(true);
		expect(isReasoningModel('gpt-5')).toBe(true);
		expect(isReasoningModel('o1')).toBe(true);
		expect(isReasoningModel('o3-mini')).toBe(true);
	});

	it('regner gpt-4o (og varianter) som ikke-reasoning', () => {
		expect(isReasoningModel('gpt-4o')).toBe(false);
		expect(isReasoningModel('gpt-4o-mini')).toBe(false);
		expect(isReasoningModel('gpt-4.1')).toBe(false);
	});
});

describe('completionTuning', () => {
	it('bruker max_completion_tokens og dropper temperatur for reasoning-modeller', () => {
		expect(completionTuning('gpt-5.5', 4000, 0.8)).toEqual({ max_completion_tokens: 4000 });
	});

	it('bruker max_tokens + temperatur for gpt-4o', () => {
		expect(completionTuning('gpt-4o', 600, 0.5)).toEqual({ max_tokens: 600, temperature: 0.5 });
	});
});
