import { describe, it, expect } from 'vitest';
import { isForbiddenCrossSiteForm, type CsrfInput } from './csrf';

const base: CsrfInput = {
	isDev: false,
	method: 'POST',
	contentType: 'application/x-www-form-urlencoded',
	origin: null,
	urlOrigin: 'https://resonans.example',
	pathname: '/settings/external-apps'
};

describe('isForbiddenCrossSiteForm', () => {
	it('avviser skjema-POST uten Origin, som SvelteKit', () => {
		expect(isForbiddenCrossSiteForm(base)).toBe(true);
	});

	it('avviser skjema-POST fra en fremmed side', () => {
		expect(isForbiddenCrossSiteForm({ ...base, origin: 'https://ond.example' })).toBe(true);
	});

	it('slipper gjennom samme opprinnelse', () => {
		expect(isForbiddenCrossSiteForm({ ...base, origin: base.urlOrigin })).toBe(false);
	});

	it('gjelder multipart, text/plain og med charset', () => {
		expect(isForbiddenCrossSiteForm({ ...base, contentType: 'multipart/form-data; boundary=x' })).toBe(true);
		expect(isForbiddenCrossSiteForm({ ...base, contentType: 'text/plain;charset=UTF-8' })).toBe(true);
	});

	it('rører ikke JSON eller GET', () => {
		expect(isForbiddenCrossSiteForm({ ...base, contentType: 'application/json' })).toBe(false);
		expect(isForbiddenCrossSiteForm({ ...base, method: 'GET' })).toBe(false);
	});

	it('slår ikke til i dev, som SvelteKits egen', () => {
		expect(isForbiddenCrossSiteForm({ ...base, isDev: true })).toBe(false);
	});

	// Token-forespørselen kommer fra Claude og ChatGPT sine servere: skjema, uten Origin.
	it('unntar OAuth-token og -revokering', () => {
		expect(isForbiddenCrossSiteForm({ ...base, pathname: '/oauth/token' })).toBe(false);
		expect(isForbiddenCrossSiteForm({ ...base, pathname: '/oauth/token/' })).toBe(false);
		expect(isForbiddenCrossSiteForm({ ...base, pathname: '/oauth/revoke' })).toBe(false);
	});

	// Samtykket er en skjema-POST som leser økta — det er nettopp det CSRF-vernet finnes for.
	it('beskytter fortsatt samtykkesiden', () => {
		expect(isForbiddenCrossSiteForm({ ...base, pathname: '/oauth/authorize' })).toBe(true);
	});
});
