import { describe, it, expect } from 'vitest';
import {
	buildWritingChatPrompt,
	isWritingChatMode,
	resolveWritingChatMode,
	WRITING_CHAT_MODES,
	WRITING_CHAT_MODE_DEFS,
	type BuildPromptInput
} from './coach-prompt';

const project = { title: 'Vinterlys', genre: 'roman', summary: 'En bror kommer hjem.' };

const base = (overrides: Partial<BuildPromptInput> = {}): BuildPromptInput => ({
	project,
	mode: 'leser',
	...overrides
});

describe('modusoppslag', () => {
	it('har en definisjon per modus', () => {
		for (const key of WRITING_CHAT_MODES) {
			expect(WRITING_CHAT_MODE_DEFS.some((d) => d.key === key)).toBe(true);
		}
		expect(WRITING_CHAT_MODE_DEFS).toHaveLength(WRITING_CHAT_MODES.length);
	});

	it('validerer moduser', () => {
		expect(isWritingChatMode('redaktor')).toBe(true);
		expect(isWritingChatMode('editor')).toBe(false);
		expect(isWritingChatMode(null)).toBe(false);
	});

	it('faller til leser — den minst inngripende modusen', () => {
		expect(resolveWritingChatMode('tull').key).toBe('leser');
		expect(resolveWritingChatMode(undefined).key).toBe('leser');
	});
});

describe('buildWritingChatPrompt', () => {
	it('nevner prosjektet og premisset', () => {
		const prompt = buildWritingChatPrompt(base());
		expect(prompt).toContain('Vinterlys');
		expect(prompt).toContain('roman');
		expect(prompt).toContain('En bror kommer hjem.');
	});

	it('bærer forbudslista i alle moduser — den skiller kompislesing fra smiger', () => {
		for (const mode of WRITING_CHAT_MODES) {
			const prompt = buildWritingChatPrompt(base({ mode }));
			expect(prompt).toContain('sterk historie');
			expect(prompt).toContain('interessant');
		}
	});

	it('ber alltid om norsk', () => {
		for (const mode of WRITING_CHAT_MODES) {
			expect(buildWritingChatPrompt(base({ mode }))).toContain('Svar på norsk.');
		}
	});

	describe('leser-modus', () => {
		it('forbyr omskrivingsforslag eksplisitt', () => {
			const prompt = buildWritingChatPrompt(base({ mode: 'leser' }));
			expect(prompt).toContain('IKKE foreslå omskrivinger');
		});

		it('tar med teksten som deles', () => {
			const prompt = buildWritingChatPrompt(
				base({ mode: 'leser', focusDoc: { kind: 'scene', title: 'Åpningen', body: 'Det regnet.' } })
			);
			expect(prompt).toContain('Åpningen');
			expect(prompt).toContain('Det regnet.');
		});

		it('holder materialet utenfor — leser ser bare teksten', () => {
			const prompt = buildWritingChatPrompt(
				base({
					mode: 'leser',
					focusDoc: { kind: 'scene', title: 'Åpningen', body: 'Det regnet.' },
					material: [{ kind: 'karakter', title: 'Ida', body: 'Lyver ofte.' }]
				})
			);
			expect(prompt).not.toContain('Ida');
		});
	});

	describe('redaktør-modus', () => {
		it('ber om prioritering framfor tolv småting', () => {
			const prompt = buildWritingChatPrompt(base({ mode: 'redaktor' }));
			expect(prompt).toContain('Prioriter');
		});

		it('ser både tekst og materiale', () => {
			const prompt = buildWritingChatPrompt(
				base({
					mode: 'redaktor',
					focusDoc: { kind: 'scene', title: 'Åpningen', body: 'Det regnet.' },
					material: [{ kind: 'karakter', title: 'Ida', body: 'Lyver ofte.' }]
				})
			);
			expect(prompt).toContain('Det regnet.');
			expect(prompt).toContain('Ida');
		});

		it('skriver ikke om manuset for brukeren uoppfordret', () => {
			expect(buildWritingChatPrompt(base({ mode: 'redaktor' }))).toContain('manuset er deres');
		});
	});

	describe('sparring-modus', () => {
		it('utelater fokusteksten — sparring handler ikke om linjer', () => {
			const prompt = buildWritingChatPrompt(
				base({
					mode: 'sparring',
					focusDoc: { kind: 'scene', title: 'Åpningen', body: 'HEMMELIG SETNING' }
				})
			);
			expect(prompt).not.toContain('HEMMELIG SETNING');
		});

		it('tar med manusets deler i rekkefølge', () => {
			const prompt = buildWritingChatPrompt(
				base({
					mode: 'sparring',
					outline: [
						{ kind: 'kapittel', title: 'Hjemkomst', words: 1200 },
						{ kind: 'scene', title: 'Middagen', words: 800 }
					]
				})
			);
			expect(prompt).toContain('1. kapittel «Hjemkomst» (1200 ord)');
			expect(prompt).toContain('2. scene «Middagen» (800 ord)');
		});

		it('sier fra når manuset er tomt framfor å la modellen anta at det finnes', () => {
			const prompt = buildWritingChatPrompt(base({ mode: 'sparring', outline: [] }));
			expect(prompt).toContain('ingen scener eller kapitler ennå');
		});
	});

	it('kutter et fokusdokument som er for langt til å bære prompten', () => {
		const prompt = buildWritingChatPrompt(
			base({ mode: 'leser', focusDoc: { kind: 'scene', title: 'Lang', body: 'a'.repeat(20000) } })
		);
		expect(prompt).toContain('[…kuttet]');
		expect(prompt.length).toBeLessThan(15000);
	});

	it('tåler prosjekt uten sjanger og premiss', () => {
		const prompt = buildWritingChatPrompt({
			project: { title: 'Uten navn' },
			mode: 'leser'
		});
		expect(prompt).toContain('Uten navn');
		expect(prompt).not.toContain('Premiss');
	});
});
