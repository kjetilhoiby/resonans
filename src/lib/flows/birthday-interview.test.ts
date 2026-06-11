import { describe, expect, it } from 'vitest';
import {
	buildInterviewMarkdown,
	extractInterviewAnswers,
	formatAnswersAsText,
	parseInterviewMarkdown
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
