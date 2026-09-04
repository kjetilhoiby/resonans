import { describe, it, expect } from 'vitest';
import {
	distanceRecords,
	formatRecordTime,
	isImplausibleEffort,
	recordNuggetText,
	recordsSetBy,
	type RecordWorkout
} from './distance-records';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-08-11T12:00:00Z').getTime();

function run(
	id: string,
	daysAgo: number,
	bestEfforts: Partial<Record<string, number>> | null,
	sportFamily = 'running'
): RecordWorkout {
	return { activityId: id, startTime: new Date(T0 - daysAgo * DAY), sportFamily, bestEfforts };
}

describe('distanceRecords', () => {
	it('finner beste tid per distanse med hvilken økt som holder den', () => {
		const records = distanceRecords([
			run('a', 30, { '1k': 260, '5k': 1450 }),
			run('b', 10, { '1k': 252, '5k': 1480 })
		]);

		expect(records.map((r) => [r.key, r.seconds, r.activityId])).toEqual([
			['1k', 252, 'b'],
			['5k', 1450, 'a']
		]);
	});

	it('utelater distanser ingen økt har et tall for', () => {
		const records = distanceRecords([run('a', 5, { '1k': 260 })]);
		expect(records.map((r) => r.key)).toEqual(['1k']);
	});

	it('holder sykling og elsykkel utenfor', () => {
		const records = distanceRecords([
			run('bike', 5, { '5k': 400 }, 'cycling'),
			run('run', 5, { '5k': 1450 })
		]);
		expect(records.map((r) => r.activityId)).toEqual(['run']);
	});

	it('ignorerer ugyldige verdier', () => {
		const records = distanceRecords([
			run('a', 5, { '1k': 0 }),
			run('b', 4, { '1k': Number.NaN }),
			run('c', 3, { '1k': 258 })
		]);
		expect(records.map((r) => r.activityId)).toEqual(['c']);
	});

	it('sorterer korteste distanse først', () => {
		const records = distanceRecords([run('a', 5, { '10k': 3000, '400m': 92, '3k': 800 })]);
		expect(records.map((r) => r.key)).toEqual(['400m', '3k', '10k']);
	});

	it('tåler tom historikk og økter uten bestEfforts', () => {
		expect(distanceRecords([])).toEqual([]);
		expect(distanceRecords([run('a', 1, null)])).toEqual([]);
	});
});

describe('recordsSetBy', () => {
	it('flagger en PR målt mot øktene FØR den', () => {
		const workout = run('ny', 0, { '5k': 1400 });
		const prior = [run('a', 30, { '5k': 1450 }), run('b', 10, { '5k': 1430 })];

		expect(recordsSetBy(workout, prior).map((r) => r.key)).toEqual(['5k']);
	});

	it('flagger ikke når en senere økt er raskere — «satte PR» endrer seg ikke', () => {
		// Økta satte PR den gangen. At den er slått siden skal ikke fjerne merket.
		const workout = run('da', 30, { '5k': 1430 });
		const others = [run('før', 60, { '5k': 1450 }), run('etter', 5, { '5k': 1400 })];

		expect(recordsSetBy(workout, others).map((r) => r.key)).toEqual(['5k']);
	});

	it('flagger ikke første gang en distanse løpes — det er ikke en PR', () => {
		const workout = run('første', 0, { '10k': 3000 });
		const prior = [run('a', 30, { '5k': 1450 })];

		expect(recordsSetBy(workout, prior)).toEqual([]);
	});

	it('flagger ikke en tid som ikke slår den beste', () => {
		const workout = run('ny', 0, { '5k': 1460 });
		expect(recordsSetBy(workout, [run('a', 30, { '5k': 1450 })])).toEqual([]);
	});

	it('flagger ikke en tid som er lik den beste', () => {
		const workout = run('ny', 0, { '5k': 1450 });
		expect(recordsSetBy(workout, [run('a', 30, { '5k': 1450 })])).toEqual([]);
	});

	it('kan flagge flere distanser i samme økt', () => {
		const workout = run('ny', 0, { '1k': 250, '5k': 1400 });
		const prior = [run('a', 30, { '1k': 260, '5k': 1450 })];

		expect(recordsSetBy(workout, prior).map((r) => r.key)).toEqual(['1k', '5k']);
	});

	it('sammenligner ikke mot sykling', () => {
		const workout = run('ny', 0, { '5k': 1400 });
		const prior = [run('bike', 30, { '5k': 400 }, 'cycling')];
		// Sykkelturen finnes ikke i sammenligningsgrunnlaget, så det er ingen
		// tidligere løpetid å slå — altså ingen PR.
		expect(recordsSetBy(workout, prior)).toEqual([]);
	});

	it('gir ingenting for en økt uten bestEfforts', () => {
		expect(recordsSetBy(run('a', 0, null), [run('b', 5, { '5k': 1450 })])).toEqual([]);
	});
});

describe('formatRecordTime', () => {
	it('formaterer under og over timen', () => {
		expect(formatRecordTime(92)).toBe('1:32');
		expect(formatRecordTime(1400)).toBe('23:20');
		expect(formatRecordTime(3734)).toBe('1:02:14');
	});

	it('nullpadder sekunder', () => {
		expect(formatRecordTime(305)).toBe('5:05');
	});
});

describe('recordNuggetText', () => {
	it('lar den lengste distansen vinne', () => {
		// En 5 km-rekord er en større nyhet enn 400-meteren som ligger inni den.
		const text = recordNuggetText([
			{ key: '400m', label: '400 m', seconds: 92, activityId: 'a', date: new Date(T0) },
			{ key: '5k', label: '5 km', seconds: 1400, activityId: 'a', date: new Date(T0) }
		]);
		expect(text).toBe('Ny 5 km-rekord: 23:20! (+1 til)');
	});

	it('nevner ingen ekstra når bare én ble satt', () => {
		const text = recordNuggetText([
			{ key: '1k', label: '1 km', seconds: 250, activityId: 'a', date: new Date(T0) }
		]);
		expect(text).toBe('Ny 1 km-rekord: 4:10!');
	});

	it('gir null uten rekorder', () => {
		expect(recordNuggetText([])).toBeNull();
	});
});

describe('isImplausibleEffort (vakt mot feilmerket idrett)', () => {
	it('forkaster tider raskere enn verdensrekorden', () => {
		// Felttest 17. august: en elsykkeltur lagret som løping ga «tidenes raskeste
		// 5 km» på 2:29/km — altså 12:25, tolv sekunder raskere enn verdensrekorden.
		// En vakt på «urimelig fort» ville sluppet det gjennom.
		expect(isImplausibleEffort('5k', 745)).toBe(true);
		expect(isImplausibleEffort('400m', 40)).toBe(true);
	});

	it('slipper gjennom alt et menneske faktisk kan løpe', () => {
		expect(isImplausibleEffort('5k', 756)).toBe(false);
		expect(isImplausibleEffort('5k', 1500)).toBe(false);
		expect(isImplausibleEffort('10k', 2400)).toBe(false);
	});

	it('ukjent distanse forkastes ikke — en ny nøkkel skal ikke stille forsvinne', () => {
		expect(isImplausibleEffort('42k', 1)).toBe(false);
	});
});

describe('umulige tider holdes utenfor rekordene', () => {
	it('en feilmerket sykkeltur tar ikke rekorden', () => {
		// Uten vakten ville denne økta holdt 5 km-rekorden for alltid, og skjult
		// den ekte.
		const records = distanceRecords([run('ekte', 5, { '5k': 1500 }), run('sykkel', 1, { '5k': 745 })]);
		const fiveK = records.find((r) => r.key === '5k');
		expect(fiveK?.activityId).toBe('ekte');
		expect(fiveK?.seconds).toBe(1500);
	});

	it('en umulig tid gir ingen PR', () => {
		const bogus = run('sykkel', 0, { '5k': 745 });
		expect(recordsSetBy(bogus, [run('ekte', 5, { '5k': 1500 })])).toEqual([]);
	});
});

describe('activityId — lenka til økta', () => {
	it('bærer id-en til økta som holder rekorden', () => {
		const records = distanceRecords([
			run('gammel', 30, { '5k': 1500 }),
			run('rekordholder', 10, { '5k': 1400 })
		]);
		expect(records).toHaveLength(1);
		expect(records[0].activityId).toBe('rekordholder');
	});

	it('godtar en klynge uten evidence-event og gir null videre', () => {
		// Rekorden er sann; det er bare lenka som mangler. Flaten viser raden
		// uten lenke framfor å tilby en som gir 404.
		const records = distanceRecords([
			{ activityId: null, startTime: new Date(T0), sportFamily: 'running', bestEfforts: { '1k': 240 } }
		]);
		expect(records).toHaveLength(1);
		expect(records[0].activityId).toBeNull();
	});

	it('lar hver distanse peke på SIN egen økt', () => {
		const records = distanceRecords([
			run('kort-og-kvikk', 20, { '1k': 230 }),
			run('lang-og-jevn', 5, { '1k': 250, '10k': 2900 })
		]);
		const byKey = Object.fromEntries(records.map((r) => [r.key, r.activityId]));
		expect(byKey['1k']).toBe('kort-og-kvikk');
		expect(byKey['10k']).toBe('lang-og-jevn');
	});
});
