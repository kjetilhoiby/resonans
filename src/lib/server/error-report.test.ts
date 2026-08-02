import { describe, it, expect } from 'vitest';
import { clientErrorMessage, describeError, formatErrorLog } from './error-report';

describe('describeError', () => {
	it('plukker navn, melding og stack fra en Error', () => {
		const err = new TypeError('rows is not iterable');
		const out = describeError(err);
		expect(out.name).toBe('TypeError');
		expect(out.message).toBe('rows is not iterable');
		expect(out.stack).toContain('TypeError');
	});

	it('tåler at det som kastes ikke er en Error', () => {
		// Alt kan kastes i JS. En hook som antar Error kaster selv, og da mister
		// vi hele rapporten.
		expect(describeError('bare en streng')).toEqual({
			name: 'Error',
			message: 'bare en streng',
			stack: null
		});
		expect(describeError({ message: 'fra postgres' }).message).toBe('fra postgres');
		expect(describeError(null).message).toBe('null');
		expect(describeError(undefined).message).toBe('undefined');
	});

	it('serialiserer objekter uten message-felt', () => {
		expect(describeError({ code: '22P02' }).message).toBe('{"code":"22P02"}');
	});

	it('faller tilbake til String(error) for tom Error-melding', () => {
		expect(describeError(new Error('')).message).toBe('Error');
	});
});

describe('formatErrorLog', () => {
	it('legger rute, metode og id i én søkbar linje', () => {
		const log = formatErrorLog({
			errorId: 'a1b2c3d4',
			routeId: '/api/tema/[id]/dashboard/sleep',
			method: 'GET',
			path: '/api/tema/abc/dashboard/sleep',
			status: 500,
			error: new Error('boom')
		});
		const [head] = log.split('\n');
		expect(head).toContain('[500]');
		expect(head).toContain('id=a1b2c3d4');
		expect(head).toContain('GET /api/tema/abc/dashboard/sleep');
		expect(head).toContain('route=/api/tema/[id]/dashboard/sleep');
		expect(head).toContain('Error: boom');
	});

	it('tar med stacken når den finnes, og hopper over den når den ikke gjør det', () => {
		const withStack = formatErrorLog({
			errorId: 'x',
			routeId: null,
			method: 'GET',
			path: '/p',
			status: 500,
			error: new Error('boom')
		});
		expect(withStack.split('\n').length).toBeGreaterThan(1);

		const withoutStack = formatErrorLog({
			errorId: 'x',
			routeId: null,
			method: 'GET',
			path: '/p',
			status: 500,
			error: 'boom'
		});
		expect(withoutStack.split('\n')).toHaveLength(1);
		expect(withoutStack).toContain('route=?');
	});
});

describe('clientErrorMessage', () => {
	it('sender den ekte feilteksten videre', () => {
		expect(clientErrorMessage(new Error('invalid input syntax for type uuid'))).toBe(
			'invalid input syntax for type uuid'
		);
	});

	it('kollapser linjeskift, slik at meldingen kan vises på én linje', () => {
		expect(clientErrorMessage(new Error('linje 1\n  linje 2'))).toBe('linje 1 linje 2');
	});

	it('kutter lange meldinger', () => {
		const long = 'a'.repeat(500);
		const out = clientErrorMessage(new Error(long), 50);
		expect(out).toHaveLength(50);
		expect(out.endsWith('…')).toBe(true);
	});

	it('har en fallback når meldingen er tom', () => {
		expect(clientErrorMessage({ message: '   ' })).toBe('Uventet feil på serveren.');
	});
});
