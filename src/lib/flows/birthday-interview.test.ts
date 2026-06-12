import { describe, expect, it } from 'vitest';
import {
	buildInterviewMarkdown,
	extractInterviewAnswers,
	formatAnswersAsText,
	formatThreadTranscript,
	parseBirthdayGoals,
	parseInterviewMarkdown,
	parseStatusBlock
} from './birthday-interview';

describe('extractInterviewAnswers', () => {
	it('plukker ut og trimmer svar fra flowData', () => {
		const answers = extractInterviewAnswers({
			who: '  En som løper mer enn i fjor  ',
			best_book: 'Solaris',
			_kavalkadeSummary: 'intern nøkkel skal ignoreres',
			speil_lastMessage: 'chat-felt skal ignoreres'
		});
		expect(answers).toEqual({
			who: 'En som løper mer enn i fjor',
			best_book: 'Solaris'
		});
	});

	it('hopper over tomme og ikke-streng-verdier', () => {
		const answers = extractInterviewAnswers({ who: '   ', changed: 42, started: null });
		expect(answers).toEqual({});
	});
});

describe('buildInterviewMarkdown + parseInterviewMarkdown', () => {
	it('runder tur-retur uten tap', () => {
		const answers = {
			who: 'En far som leser mer.\nOg som har begynt å svømme.',
			changed: 'Byttet jobb i mars',
			best_concert: 'Bon Iver i Operaen',
			mirror: 'Du virker mer til stede enn i fjor.'
		};
		const markdown = buildInterviewMarkdown(answers);
		expect(parseInterviewMarkdown(markdown)).toEqual(answers);
	});

	it('utelater ubesvarte spørsmål fra markdown', () => {
		const markdown = buildInterviewMarkdown({ who: 'Meg', best_film: '' });
		expect(markdown).toBe('## Hvem er du i år?\nMeg');
	});

	it('bevarer seksjonsrekkefølgen fra spørsmålslisten', () => {
		const markdown = buildInterviewMarkdown({
			best_book: 'Stoner',
			who: 'Meg',
			memory: 'Sommerturen'
		});
		expect(markdown).toMatchInlineSnapshot(`
			"## Hvem er du i år?
			Meg

			## Hva husker du best?
			Sommerturen

			## Beste bok
			Stoner"
		`);
	});

	it('ignorerer ukjente overskrifter ved parsing', () => {
		const parsed = parseInterviewMarkdown(
			'## Hvem er du i år?\nMeg\n\n## Ukjent seksjon\nSkal bort\n\n## Beste bok\nStoner'
		);
		expect(parsed).toEqual({ who: 'Meg', best_book: 'Stoner' });
	});

	it('tåler tom og overskriftsløs tekst', () => {
		expect(parseInterviewMarkdown('')).toEqual({});
		expect(parseInterviewMarkdown('bare løs tekst uten overskrift')).toEqual({});
	});
});

describe('roller, helse og retning', () => {
	it('runder tur-retur med de nye seksjonene', () => {
		const answers = {
			who: 'Meg',
			role_dad: 'Mer til stede enn i fjor',
			role_partner: 'Vi har funnet rytmen igjen',
			health_talk: 'Var: sliten. Ville: ned i vekt. Veien: 84 → 82. Videre: holde søvnen.',
			goals_past: 'Løpe 500 km',
			direction: 'Mindre skjerm, mer svømming'
		};
		expect(parseInterviewMarkdown(buildInterviewMarkdown(answers))).toEqual(answers);
	});
});

describe('parseStatusBlock', () => {
	it('henter innholdet mellom status-markørene', () => {
		const message = 'Fint — da går vi videre!\n\n<status>\nVar: sliten etter flytting.\nVille: ned 3 kg.\nVeien: 84,6 → 82,1.\nVidere: beholde morgentreningen.\n</status>';
		expect(parseStatusBlock(message)).toBe(
			'Var: sliten etter flytting.\nVille: ned 3 kg.\nVeien: 84,6 → 82,1.\nVidere: beholde morgentreningen.'
		);
	});

	it('er tom uten markører — lagrer aldri løs prosa', () => {
		expect(parseStatusBlock('Bare en vanlig melding uten oppsummering')).toBe('');
		expect(parseStatusBlock('')).toBe('');
	});
});

describe('parseBirthdayGoals', () => {
	it('parser målbare mål og rene intensjonsmål fra markør-blokken', () => {
		const message =
			'Da setter vi dem!\n\n<bursdagsmål>\n- Løpe til neste bursdag: 600 km\n- Lese: 6 bøker\n- Skjermfri etter 22\n</bursdagsmål>';
		expect(parseBirthdayGoals(message)).toEqual([
			{ title: 'Løpe til neste bursdag', value: 600, unit: 'km' },
			{ title: 'Lese', value: 6, unit: 'bøker' },
			{ title: 'Skjermfri etter 22', value: null, unit: null }
		]);
	});

	it('tåler desimaltall med komma og begrenser til 6 mål', () => {
		const lines = Array.from({ length: 9 }, (_, i) => `- Mål ${i}: ${i} ganger`).join('\n');
		expect(parseBirthdayGoals(`<bursdagsmål>\n- Ned i vekt: 2,5 kg\n${lines}\n</bursdagsmål>`)[0])
			.toEqual({ title: 'Ned i vekt', value: 2.5, unit: 'kg' });
		expect(parseBirthdayGoals(`<bursdagsmål>\n${lines}\n</bursdagsmål>`)).toHaveLength(6);
	});

	it('er tom uten markører', () => {
		expect(parseBirthdayGoals('Ingen mål her')).toEqual([]);
	});
});

describe('formatThreadTranscript', () => {
	it('lager Du/Resonans-transkript og stripper markør-blokker', () => {
		const thread = [
			{ role: 'user', text: 'Jeg er klar.' },
			{ role: 'assistant', text: 'Hvor var du i fjor?\n\n<status>\nVar: sliten.\n</status>' },
			{ role: 'user', text: 'Sliten, men i gang.' }
		];
		expect(formatThreadTranscript(thread)).toBe(
			'Du: Jeg er klar.\n\nResonans: Hvor var du i fjor?\n\nDu: Sliten, men i gang.'
		);
	});

	it('tåler tomme og ugyldige tråder', () => {
		expect(formatThreadTranscript(undefined)).toBe('');
		expect(formatThreadTranscript([{ role: 'assistant', text: '<status>x</status>' }])).toBe('');
	});
});

describe('formatAnswersAsText', () => {
	it('lager punktliste med spørsmål og svar, uten speil-seksjonen', () => {
		const text = formatAnswersAsText({
			who: 'Meg',
			best_book: 'Stoner',
			mirror: 'AI-oppsummering skal ikke med'
		});
		expect(text).toBe('- Hvem er du i år? Meg\n- Beste bok Stoner');
	});
});
