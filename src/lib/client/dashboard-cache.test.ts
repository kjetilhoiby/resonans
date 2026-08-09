// @vitest-environment jsdom
// Cachen bor i localStorage, så denne ene fila trenger et DOM. Resten av suiten
// kjører i node — se vitest.config.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HEALTH_FAMILY_KINDS } from '$lib/domain/health-subthemes';

/**
 * `invalidateHealthFamily` skal dekke HELE helse-familien.
 *
 * Regresjonen testen finnes for: funksjonen skrev sin egen parallelle liste over
 * dashboardtyper. Da Vekt ble eget undertema i august 2026 ble 'weight' lagt til i
 * `HEALTH_SUBTHEMES` og glemt der, og alle tre kallstedene trodde de hadde tømt
 * cachen mens vektflaten fortsatte å male fra en gammel payload.
 *
 * Testen låser at lista er DERIVERT, ikke skrevet: legger noen til et undertema uten
 * at invalideringen følger med, feiler den her framfor i drift.
 */
describe('invalidateHealthFamily', () => {
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
	});

	it('tømmer cachen for hvert medlem av helse-familien', async () => {
		const { invalidateHealthFamily } = await import('./dashboard-cache');

		// Én cachet payload per type i familien, pluss én utenfor den.
		for (const kind of HEALTH_FAMILY_KINDS) {
			localStorage.setItem(`resonans:dashboard:v4:tema-1:${kind}`, '{"data":{},"cachedAt":"x"}');
		}
		localStorage.setItem('resonans:dashboard:v4:tema-1:economics', '{"data":{},"cachedAt":"x"}');

		invalidateHealthFamily();

		for (const kind of HEALTH_FAMILY_KINDS) {
			expect(
				localStorage.getItem(`resonans:dashboard:v4:tema-1:${kind}`),
				`${kind} skulle vært tømt`
			).toBeNull();
		}
	});

	it('lar dashboard utenfor familien være i fred', async () => {
		const { invalidateHealthFamily } = await import('./dashboard-cache');

		localStorage.setItem('resonans:dashboard:v4:tema-1:economics', '{"data":{},"cachedAt":"x"}');

		invalidateHealthFamily();

		expect(localStorage.getItem('resonans:dashboard:v4:tema-1:economics')).not.toBeNull();
	});

	it('dekker vekt — undertemaet som ble glemt', async () => {
		// Eksplisitt, ikke bare gjennom løkka over: det var denne som manglet, og en
		// test som bare itererer over lista ville passert også med den gamle bugen
		// hvis noen skrev om lista igjen.
		expect(HEALTH_FAMILY_KINDS).toContain('weight');
	});
});
