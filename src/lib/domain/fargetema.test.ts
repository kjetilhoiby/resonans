import { describe, expect, it } from 'vitest';
import {
	applyFargetemaToHtml,
	DEFAULT_FARGETEMA,
	FARGETEMA_COOKIE,
	fargetemaCookie,
	parseFargetema
} from './fargetema';

describe('parseFargetema', () => {
	it('godtar de tre valgene', () => {
		expect(parseFargetema('system')).toBe('system');
		expect(parseFargetema('lys')).toBe('lys');
		expect(parseFargetema('mork')).toBe('mork');
	});

	it('faller til standarden på alt ukjent, tomt eller manglende', () => {
		expect(parseFargetema(undefined)).toBe(DEFAULT_FARGETEMA);
		expect(parseFargetema(null)).toBe(DEFAULT_FARGETEMA);
		expect(parseFargetema('')).toBe(DEFAULT_FARGETEMA);
		expect(parseFargetema('dark')).toBe(DEFAULT_FARGETEMA);
		expect(parseFargetema('mørk')).toBe(DEFAULT_FARGETEMA);
	});

	it('standarden er å følge telefonen', () => {
		expect(DEFAULT_FARGETEMA).toBe('system');
	});
});

describe('fargetemaCookie', () => {
	it('skriver navn, verdi, sti og levetid', () => {
		const cookie = fargetemaCookie('lys');
		expect(cookie.startsWith(`${FARGETEMA_COOKIE}=lys;`)).toBe(true);
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('Max-Age=');
		expect(cookie).toContain('SameSite=Lax');
	});
});

describe('applyFargetemaToHtml', () => {
	it('setter valget inn i plassholderen', () => {
		expect(applyFargetemaToHtml('<html data-fargetema="%resonans.fargetema%">', 'mork')).toBe(
			'<html data-fargetema="mork">'
		);
	});

	it('lar en tekst uten plassholder stå urørt', () => {
		expect(applyFargetemaToHtml('<div>bit</div>', 'lys')).toBe('<div>bit</div>');
	});
});
