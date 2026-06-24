import { describe, it, expect } from 'vitest';
import { buildTimeContext } from './assistant';

/**
 * Nå-kontekst forankrer assistenten til Oslo-tid. Uten den hallusinerte modellen feil årstall
 * (brukertest viste «i dag er det 6. november 2023»). Testene verifiserer at riktig dato, ukedag
 * og klokkeslett kommer med — i Oslo-tidssone, ikke serverens UTC.
 */
describe('buildTimeContext', () => {
	it('inkluderer riktig ISO-dato, ukedag og årstall', () => {
		// 2026-06-24 er en onsdag.
		const ctx = buildTimeContext(new Date('2026-06-24T10:00:00Z'));
		expect(ctx).toContain('ISO 2026-06-24');
		expect(ctx).toContain('onsdag');
		expect(ctx).toContain('2026');
	});

	it('bruker Oslo-tid, ikke UTC, for klokkeslett og datoskifte', () => {
		// 22:30 UTC = 00:30 neste dag i Oslo (sommertid, UTC+2).
		const ctx = buildTimeContext(new Date('2026-06-24T22:30:00Z'));
		expect(ctx).toContain('klokka 00:30');
		expect(ctx).toContain('ISO 2026-06-25');
	});
});
