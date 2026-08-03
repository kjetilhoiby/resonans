import { describe, it, expect } from 'vitest';
import {
	BEHIND_THRESHOLD,
	describeIntakePacing,
	expectedShareAtHour,
	osloHourNow
} from './intake-pacing';

describe('expectedShareAtHour', () => {
	it('er null før frokost og full ved midnatt', () => {
		expect(expectedShareAtHour(5)).toBe(0);
		expect(expectedShareAtHour(24)).toBe(1);
	});

	it('stiger monotont gjennom dagen', () => {
		let prev = -1;
		for (let hour = 0; hour <= 24; hour++) {
			const share = expectedShareAtHour(hour);
			expect(share, `time ${hour}`).toBeGreaterThanOrEqual(prev);
			prev = share;
		}
	});

	it('er ikke lineær over døgnet', () => {
		// En jevn fordeling ville sagt 25 % kl. 06. Folk spiser ikke mens de sover.
		expect(expectedShareAtHour(6)).toBeLessThan(0.05);
		expect(expectedShareAtHour(15)).toBeGreaterThan(0.4);
	});

	it('tåler tall utenfor døgnet', () => {
		expect(expectedShareAtHour(-3)).toBe(0);
		expect(expectedShareAtHour(99)).toBe(1);
	});
});

describe('describeIntakePacing', () => {
	it('forklarer sultkrisa 3. august', () => {
		// 304 kcal kl. 15 mot et mål på 2 600. Forventet rundt 45 %.
		const pacing = describeIntakePacing({
			kcalSoFar: 304,
			proteinSoFar: 19,
			targetKcal: 2600,
			targetProteinG: 180,
			osloHour: 15
		});
		expect(pacing.actualShare).toBeCloseTo(0.12, 2);
		expect(pacing.expectedShare).toBeCloseTo(0.45, 2);
		expect(pacing.deltaShare).toBeLessThan(-BEHIND_THRESHOLD);
		expect(pacing.behind).toBe(true);
		expect(pacing.expectedKcalByNow).toBe(1170);
	});

	it('lar en normal dag være i fred', () => {
		const pacing = describeIntakePacing({
			kcalSoFar: 1200,
			proteinSoFar: 80,
			targetKcal: 2600,
			targetProteinG: 180,
			osloHour: 15
		});
		expect(pacing.behind).toBe(false);
	});

	it('påstår ingenting uten kcal-mål', () => {
		const pacing = describeIntakePacing({
			kcalSoFar: 304,
			proteinSoFar: 19,
			targetKcal: null,
			targetProteinG: null,
			osloHour: 15
		});
		expect(pacing.actualShare).toBeNull();
		expect(pacing.deltaShare).toBeNull();
		expect(pacing.behind).toBe(false);
		// Tallene som ikke krever mål er likevel med.
		expect(pacing.kcalSoFar).toBe(304);
		expect(pacing.expectedShare).toBeGreaterThan(0);
	});

	it('flagger ikke et lite avvik', () => {
		const pacing = describeIntakePacing({
			kcalSoFar: 2600 * (expectedShareAtHour(15) - 0.1),
			proteinSoFar: 60,
			targetKcal: 2600,
			targetProteinG: 180,
			osloHour: 15
		});
		expect(pacing.behind).toBe(false);
	});
});

describe('osloHourNow', () => {
	it('gir timen som desimal', () => {
		// 12:30 UTC om sommeren er 14:30 i Oslo.
		expect(osloHourNow(new Date('2026-08-03T12:30:00Z'))).toBeCloseTo(14.5, 1);
	});

	it('bruker Oslo og ikke UTC om vinteren også', () => {
		expect(osloHourNow(new Date('2026-01-15T12:00:00Z'))).toBeCloseTo(13, 1);
	});
});
