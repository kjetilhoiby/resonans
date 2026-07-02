import { describe, it, expect } from 'vitest';
import { buildFinalizeMessages, finalizePlanField } from './plan-field-writer';

describe('buildFinalizeMessages', () => {
	it('bygger et system-prompt for riktig type og periode', () => {
		const [system] = buildFinalizeMessages('reflection', [], 'juni');
		expect(system.role).toBe('system');
		expect(system.content).toContain('refleksjon');
		expect(system.content).toContain('juni');
		expect(system.content).toContain('BRUKERENS');
	});

	it('merker opp hvem som sa hva i transkriptet', () => {
		const [, user] = buildFinalizeMessages(
			'note',
			[
				{ role: 'assistant', text: 'Hva handler juli om for deg?' },
				{ role: 'user', text: 'Mer jevnhet og ro.' }
			],
			'juli'
		);
		expect(user.content).toBe('ASSISTENT: Hva handler juli om for deg?\n\nBRUKER: Mer jevnhet og ro.');
	});
});

describe('finalizePlanField', () => {
	it('returnerer tom streng uten kall når tråden er tom', async () => {
		expect(await finalizePlanField('note', [])).toBe('');
		expect(await finalizePlanField('reflection', undefined)).toBe('');
		expect(await finalizePlanField('note', [{ role: 'user', text: '   ' }])).toBe('');
	});
});
