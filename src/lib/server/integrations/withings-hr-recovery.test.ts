import { describe, it, expect } from 'vitest';
import { groupIntoFetchWindows } from './withings-hr-recovery';

/** Kortform: en økt som slutter på gitt tidspunkt. */
function workout(endIso: string, sportFamily = 'running') {
	const endTime = new Date(endIso);
	return { startTime: new Date(endTime.getTime() - 1800_000), endTime, sportFamily };
}

describe('groupIntoFetchWindows', () => {
	it('slår sammen økter samme dag til ett kall', () => {
		// To løpeturer samme dag skal ikke koste to Withings-kall.
		const windows = groupIntoFetchWindows([
			workout('2026-08-01T08:23:49.000Z'),
			workout('2026-08-01T19:47:26.000Z')
		]);
		expect(windows).toHaveLength(1);
		expect(windows[0].workouts).toHaveLength(2);
	});

	it('dekker første og siste økt i vinduet', () => {
		const windows = groupIntoFetchWindows([
			workout('2026-08-01T08:23:49.000Z'),
			workout('2026-08-01T19:47:26.000Z')
		]);
		// Vinduet må starte før den første og slutte etter den siste, med slakk nok
		// til at ankeret kan ligge før oppgitt slutt.
		expect(windows[0].from.getTime()).toBeLessThan(new Date('2026-08-01T08:23:49.000Z').getTime());
		expect(windows[0].to.getTime()).toBeGreaterThan(new Date('2026-08-01T19:47:26.000Z').getTime());
	});

	it('gir slakk før slutt, siden ankeret ligger før stoppknappen', () => {
		const windows = groupIntoFetchWindows([workout('2026-08-01T19:47:26.000Z')]);
		const secondsBefore = (new Date('2026-08-01T19:47:26.000Z').getTime() - windows[0].from.getTime()) / 1000;
		// Toppulsen er målt opptil 105 s før oppgitt slutt, så slakken må være over det.
		expect(secondsBefore).toBeGreaterThan(120);
	});

	it('deler på dato', () => {
		const windows = groupIntoFetchWindows([
			workout('2026-07-31T20:34:27.000Z'),
			workout('2026-08-01T19:47:26.000Z')
		]);
		expect(windows).toHaveLength(2);
	});

	it('sorterer nyeste dag først, så taket rammer de eldste', () => {
		const windows = groupIntoFetchWindows([
			workout('2026-07-25T15:01:58.000Z'),
			workout('2026-08-01T19:47:26.000Z'),
			workout('2026-07-28T19:22:39.000Z')
		]);
		expect(windows.map((w) => w.workouts[0].endTime.toISOString().slice(0, 10))).toEqual([
			'2026-08-01',
			'2026-07-28',
			'2026-07-25'
		]);
	});

	it('tåler en økt rett før midnatt', () => {
		// Vinduet er definert av tidsstempler, ikke datoer, så det får krysse døgnet.
		const windows = groupIntoFetchWindows([workout('2026-08-01T23:58:00.000Z')]);
		expect(windows).toHaveLength(1);
		expect(windows[0].to.toISOString().slice(0, 10)).toBe('2026-08-02');
	});

	it('gir ingen vinduer for ingen økter', () => {
		expect(groupIntoFetchWindows([])).toEqual([]);
	});
});
