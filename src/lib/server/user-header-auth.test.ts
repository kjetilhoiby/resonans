import { describe, it, expect } from 'vitest';
import {
	headerAuthDiagnosis,
	isUserHeaderTrusted,
	unsecuredHeaderWarning,
	USER_ID_HEADER,
	USER_SECRET_HEADER
} from './user-header-auth';

/** Minimal Headers-erstatning, så testene ikke trenger en Request. */
function headers(entries: Record<string, string>) {
	const lower = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
	return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

const UUID = '8e8b4aae-14f4-4e79-8fc3-ec5f37b0579d';

describe('isUserHeaderTrusted', () => {
	it('godtar headeren fritt lokalt', () => {
		// Playwright kjører mot localhost og skal ikke trenge en hemmelighet.
		expect(isUserHeaderTrusted(headers({ [USER_ID_HEADER]: UUID }), { isDev: true, expectedSecret: undefined })).toBe(true);
	});

	it('krever hemmelighet når det er deployet', () => {
		const h = headers({ [USER_ID_HEADER]: UUID });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
	});

	it('godtar riktig hemmelighet', () => {
		const h = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'hemmelig' });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(true);
	});

	it('avviser feil hemmelighet', () => {
		const h = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'nesten' });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
	});

	it('godtar headeren når ingen hemmelighet er konfigurert', () => {
		// Miljøvariabelen er bryteren: uten den er det ingen lås, og tilgangen
		// virker som før. Bevisst fail *open* — advarselen er det eneste sporet.
		const h = headers({ [USER_ID_HEADER]: UUID });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: undefined })).toBe(true);
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: '' })).toBe(true);
	});

	it('låser i det hemmeligheten settes, uten andre endringer', () => {
		const bare = headers({ [USER_ID_HEADER]: UUID });
		expect(isUserHeaderTrusted(bare, { isDev: false, expectedSecret: undefined })).toBe(true);
		expect(isUserHeaderTrusted(bare, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
	});

	it('gir false uten bruker-header, uansett hemmelighet', () => {
		const h = headers({ [USER_SECRET_HEADER]: 'hemmelig' });
		expect(isUserHeaderTrusted(h, { isDev: true, expectedSecret: undefined })).toBe(false);
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
		// Også når det ikke finnes noen lås: en tom forespørsel er ikke en bruker.
		expect(isUserHeaderTrusted(headers({}), { isDev: false, expectedSecret: undefined })).toBe(false);
	});

	it('sammenligner hele hemmeligheten, ikke prefikset', () => {
		const h = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'hem' });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
	});
});

describe('headerAuthDiagnosis', () => {
	it('er stille når headeren er ulåst — det er ingen avvisning', () => {
		const h = headers({ [USER_ID_HEADER]: UUID });
		expect(headerAuthDiagnosis(h, { isDev: false, expectedSecret: undefined })).toBeNull();
	});

	it('er stille når hemmeligheten stemmer', () => {
		const h = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'hemmelig' });
		expect(headerAuthDiagnosis(h, { isDev: false, expectedSecret: 'hemmelig' })).toBeNull();
	});

	it('skiller manglende hemmelighet fra feil hemmelighet', () => {
		const missing = headers({ [USER_ID_HEADER]: UUID });
		expect(headerAuthDiagnosis(missing, { isDev: false, expectedSecret: 'hemmelig' })).toContain(
			`mangler ${USER_SECRET_HEADER}`
		);

		const wrong = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'nei' });
		expect(headerAuthDiagnosis(wrong, { isDev: false, expectedSecret: 'hemmelig' })).toContain(
			'stemmer ikke'
		);
	});

	it('er stille når det ikke er noe å diagnostisere', () => {
		expect(headerAuthDiagnosis(headers({}), { isDev: false, expectedSecret: 'h' })).toBeNull();
		expect(headerAuthDiagnosis(headers({ [USER_ID_HEADER]: UUID }), { isDev: true, expectedSecret: undefined })).toBeNull();
	});
});

describe('unsecuredHeaderWarning', () => {
	it('advarer når låsen ikke står på i et deployet miljø', () => {
		expect(unsecuredHeaderWarning({ isDev: false, expectedSecret: undefined })).toContain(
			'RESONANS_HEADER_SECRET'
		);
		expect(unsecuredHeaderWarning({ isDev: false, expectedSecret: '' })).not.toBeNull();
	});

	it('er stille lokalt og når hemmeligheten er satt', () => {
		expect(unsecuredHeaderWarning({ isDev: true, expectedSecret: undefined })).toBeNull();
		expect(unsecuredHeaderWarning({ isDev: false, expectedSecret: 'hemmelig' })).toBeNull();
	});
});
