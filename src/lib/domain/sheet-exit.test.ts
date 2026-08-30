import { describe, it, expect } from 'vitest';
import { resolveSheetExit, SHEET_EXIT_HOME } from './sheet-exit';

describe('resolveSheetExit', () => {
	it('går tilbake når brukeren kom fra en side i appen', () => {
		expect(resolveSheetExit({ cameFromApp: true, fallbackHref: '/tema/abc' })).toEqual({
			action: 'back'
		});
	});

	it('navigerer når arket var inngangen', () => {
		/**
		 * Regresjonen: fra en push-varsling er arket første oppføring i historikken,
		 * og `history.back()` gjør ingenting. Tilbakeknappen, bakteppet og Escape
		 * pekte alle på samme døde kall — arket hadde ingen utgang.
		 */
		expect(resolveSheetExit({ cameFromApp: false, fallbackHref: '/tema/abc' })).toEqual({
			action: 'navigate',
			href: '/tema/abc'
		});
	});

	it('faller til forsiden når vi ikke vet hvor arket hører hjemme', () => {
		expect(resolveSheetExit({ cameFromApp: false })).toEqual({
			action: 'navigate',
			href: SHEET_EXIT_HOME
		});
		expect(resolveSheetExit({ cameFromApp: false, fallbackHref: null })).toEqual({
			action: 'navigate',
			href: SHEET_EXIT_HOME
		});
	});

	it('behandler en tom eller blank href som ukjent', () => {
		// En tom streng fra serveren skal ikke bli en navigasjon til ingensteds.
		expect(resolveSheetExit({ cameFromApp: false, fallbackHref: '' }).action).toBe('navigate');
		expect(resolveSheetExit({ cameFromApp: false, fallbackHref: '   ' })).toEqual({
			action: 'navigate',
			href: SHEET_EXIT_HOME
		});
	});

	it('lar historikken vinne over fallbacken', () => {
		// Kom du fra lista, skal du tilbake til lista slik den var — med scrollposisjon
		// og alt. En navigasjon ville lastet den på nytt fra toppen.
		expect(resolveSheetExit({ cameFromApp: true }).action).toBe('back');
	});
});
