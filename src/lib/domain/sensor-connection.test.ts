import { describe, it, expect } from 'vitest';
import { needsReauthentication, hasConnectionWarning } from './sensor-connection';

describe('needsReauthentication', () => {
	it('krever innlogging når refresh-tokenet mangler', () => {
		expect(needsReauthentication({ hasRefreshToken: false })).toBe(true);
	});

	it('krever IKKE innlogging når refresh-tokenet finnes', () => {
		expect(needsReauthentication({ hasRefreshToken: true })).toBe(false);
	});

	it('krever ikke innlogging selv om siste synk feilet', () => {
		// Et avvist refresh token ligger fortsatt i raden og ser friskt ut.
		// Feilen skal VISES, men «logg inn på nytt» er ikke svaret så lenge
		// vi har et token å prøve med.
		expect(needsReauthentication({ hasRefreshToken: true, lastError: '401 fra SB1' })).toBe(false);
	});
});

describe('hasConnectionWarning', () => {
	it('varsler når refresh-tokenet mangler', () => {
		expect(hasConnectionWarning({ hasRefreshToken: false })).toBe(true);
	});

	it('varsler når siste synk feilet', () => {
		expect(hasConnectionWarning({ hasRefreshToken: true, lastError: 'noe gikk galt' })).toBe(true);
	});

	it('er stille på en frisk tilkobling', () => {
		expect(hasConnectionWarning({ hasRefreshToken: true, lastError: null })).toBe(false);
		expect(hasConnectionWarning({ hasRefreshToken: true })).toBe(false);
	});

	it('teller en tom feilmelding som ingen feil', () => {
		// `lastError: ''` skal ikke gi et varsel uten tekst å vise.
		expect(hasConnectionWarning({ hasRefreshToken: true, lastError: '' })).toBe(false);
	});
});
