import { describe, it, expect } from 'vitest';
import {
	headerAuthDiagnosis,
	isUserHeaderTrusted,
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

	it('avviser når hemmeligheten ikke er konfigurert i prod', () => {
		// Fail closed: en glemt miljøvariabel skal gi tapt tilgang, ikke åpen dør.
		// Dette er hele hullet som ble lukket.
		const h = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'hva som helst' });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: undefined })).toBe(false);
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: '' })).toBe(false);
	});

	it('gir false uten bruker-header, uansett hemmelighet', () => {
		const h = headers({ [USER_SECRET_HEADER]: 'hemmelig' });
		expect(isUserHeaderTrusted(h, { isDev: true, expectedSecret: undefined })).toBe(false);
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
	});

	it('sammenligner hele hemmeligheten, ikke prefikset', () => {
		const h = headers({ [USER_ID_HEADER]: UUID, [USER_SECRET_HEADER]: 'hem' });
		expect(isUserHeaderTrusted(h, { isDev: false, expectedSecret: 'hemmelig' })).toBe(false);
	});
});

describe('headerAuthDiagnosis', () => {
	it('sier at miljøvariabelen mangler', () => {
		const h = headers({ [USER_ID_HEADER]: UUID });
		expect(headerAuthDiagnosis(h, { isDev: false, expectedSecret: undefined })).toContain(
			'RESONANS_HEADER_SECRET er ikke satt'
		);
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
