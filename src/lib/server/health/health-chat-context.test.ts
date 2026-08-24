import { describe, it, expect } from 'vitest';
import { shouldBuildHealthContext } from './health-chat-context';

const HELSE = 'theme-helse';
const TRENING = 'theme-trening';
const FILM = 'theme-film';

describe('shouldBuildHealthContext', () => {
	it('bygger når meldingen er rutet til helse', () => {
		expect(
			shouldBuildHealthContext({
				domains: ['health'],
				conversationThemeId: null,
				healthThemeIds: [HELSE, TRENING]
			})
		).toBe(true);
	});

	it('bygger når samtalen ligger på et helse-tema, uansett ord', () => {
		// Dette er halvdelen som betyr noe: «hva tenker du om dette?» i en tråd på
		// Trening er et helsespørsmål ingen av ordene avslører.
		expect(
			shouldBuildHealthContext({
				domains: ['general'],
				conversationThemeId: TRENING,
				healthThemeIds: [HELSE, TRENING]
			})
		).toBe(true);
	});

	it('bygger IKKE på et tema utenfor helse-familien', () => {
		expect(
			shouldBuildHealthContext({
				domains: ['general'],
				conversationThemeId: FILM,
				healthThemeIds: [HELSE, TRENING]
			})
		).toBe(false);
	});

	it('bygger IKKE for en samtale uten tema og uten helse-ord', () => {
		// Briefingen koster to dashboard-lastere. Den skal ikke fyre på alt.
		expect(
			shouldBuildHealthContext({
				domains: ['economics'],
				conversationThemeId: null,
				healthThemeIds: [HELSE, TRENING]
			})
		).toBe(false);
	});

	it('takler en bruker uten helse-temaer', () => {
		expect(
			shouldBuildHealthContext({
				domains: ['general'],
				conversationThemeId: HELSE,
				healthThemeIds: []
			})
		).toBe(false);
	});
});
