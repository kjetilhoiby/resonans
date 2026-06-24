import { describe, it, expect } from 'vitest';
import { classifyTier, providerFor } from './model-router';

/**
 * Modell-routing: tunge resonnement-turer → sterk modell, lett prat/oppslag → rask. Klassifiseren
 * er ren og låses her. (resolveModels leser env og testes ikke isolert.)
 */
describe('classifyTier', () => {
	it('ruter planleggings-/anbefalingsspråk til reasoning', () => {
		expect(classifyTier('Hva bør jeg prioritere i morgen?')).toBe('reasoning');
		expect(classifyTier('Rekker bilen til hytta på det jeg har nå?')).toBe('reasoning');
		expect(classifyTier('Kan du anbefale en rute?')).toBe('reasoning');
		expect(classifyTier('Legg en plan for uka')).toBe('reasoning');
	});

	it('ruter kort prat/enkle oppslag til fast', () => {
		expect(classifyTier('Hei!')).toBe('fast');
		expect(classifyTier('Takk')).toBe('fast');
		expect(classifyTier('Hvor står bilen?')).toBe('fast');
		expect(classifyTier('')).toBe('fast');
	});

	it('ruter lange, sammensatte spørsmål til reasoning', () => {
		const long =
			'jeg lurer på om vi har råd til en ekstra ferie i sommer gitt forbruket vårt de siste månedene og';
		expect(classifyTier(long)).toBe('reasoning');
	});
});

describe('providerFor', () => {
	it('mapper claude-* til anthropic og resten til openai', () => {
		expect(providerFor('claude-sonnet-4-6')).toBe('anthropic');
		expect(providerFor('claude-haiku-4-5-20251001')).toBe('anthropic');
		expect(providerFor('gpt-4o')).toBe('openai');
		expect(providerFor('gpt-4o-mini')).toBe('openai');
	});
});
