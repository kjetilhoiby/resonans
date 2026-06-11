import { describe, expect, it } from 'vitest';
import { buildGreetingsMarkdown, parseGreetingsMarkdown } from './kavalkade-magi';

describe('buildGreetingsMarkdown + parseGreetingsMarkdown', () => {
	it('runder tur-retur uten tap', () => {
		const greetings = [
			{ character: 'Kris Kelvin', book: 'Solaris', text: 'Gratulerer med dagen.\nSelv havet her ute husker deg.' },
			{ character: 'William Stoner', book: 'Stoner', text: 'Et stille år er også et liv.' }
		];
		expect(parseGreetingsMarkdown(buildGreetingsMarkdown(greetings))).toEqual(greetings);
	});

	it('hopper over hilsner uten karakter eller tekst', () => {
		const markdown = buildGreetingsMarkdown([
			{ character: '', book: 'Solaris', text: 'Hei' },
			{ character: 'Stoner', book: 'Stoner', text: '   ' },
			{ character: 'Kelvin', book: 'Solaris', text: 'Gratulerer!' }
		]);
		expect(parseGreetingsMarkdown(markdown)).toEqual([
			{ character: 'Kelvin', book: 'Solaris', text: 'Gratulerer!' }
		]);
	});

	it('tåler tankestrek i boktittelen', () => {
		const greetings = [{ character: 'Smilla', book: 'Frøken Smillas fornemmelse — for snø', text: 'Gratulerer.' }];
		expect(parseGreetingsMarkdown(buildGreetingsMarkdown(greetings))).toEqual(greetings);
	});

	it('returnerer tom liste for tom eller uformatert tekst', () => {
		expect(parseGreetingsMarkdown('')).toEqual([]);
		expect(parseGreetingsMarkdown('bare prosa')).toEqual([]);
	});
});
