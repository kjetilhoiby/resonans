import { describe, it, expect } from 'vitest';
import { dateWindow, isTripUpcoming } from './proactive-research-service';

describe('dateWindow', () => {
	it('gir i dag og horisont N dager fram', () => {
		const now = new Date('2026-07-01T10:00:00Z');
		const { today, horizon } = dateWindow(now, 45);
		expect(today).toBe('2026-07-01');
		expect(horizon).toBe('2026-08-15');
	});
});

describe('isTripUpcoming', () => {
	const today = '2026-07-01';
	const horizon = '2026-08-15';

	it('reise som starter innen horisonten er aktuell', () => {
		expect(isTripUpcoming({ startDate: '2026-07-20', endDate: '2026-07-27' }, today, horizon)).toBe(true);
	});

	it('pågående reise (start i fortid, slutt i framtid) er aktuell', () => {
		expect(isTripUpcoming({ startDate: '2026-06-28', endDate: '2026-07-05' }, today, horizon)).toBe(true);
	});

	it('reise som allerede er over er ikke aktuell', () => {
		expect(isTripUpcoming({ startDate: '2026-06-01', endDate: '2026-06-10' }, today, horizon)).toBe(false);
	});

	it('reise for langt fram er ikke aktuell', () => {
		expect(isTripUpcoming({ startDate: '2026-10-01', endDate: '2026-10-10' }, today, horizon)).toBe(false);
	});

	it('uten startdato er ikke aktuell', () => {
		expect(isTripUpcoming({}, today, horizon)).toBe(false);
	});

	it('startdato = horisont er akkurat innenfor', () => {
		expect(isTripUpcoming({ startDate: horizon }, today, horizon)).toBe(true);
	});
});
