import { describe, it, expect } from 'vitest';
import {
	describeDisturbanceWindow,
	disturbanceMeta,
	groupDisturbancesByNight,
	isSleepDisturbanceKind,
	nightKeyForTime,
	SLEEP_DISTURBANCE_KINDS,
	SLEEP_DISTURBANCES,
	type LoggedDisturbance
} from './disturbance';

function entry(overrides: Partial<LoggedDisturbance> = {}): LoggedDisturbance {
	return {
		id: 'a',
		timestamp: '2026-08-03T21:30:00.000Z',
		kind: 'innsovning',
		awakeMinutes: 45,
		note: null,
		...overrides
	};
}

describe('SLEEP_DISTURBANCES', () => {
	it('dekker de to tilfellene, i rekkefølge', () => {
		expect(SLEEP_DISTURBANCES.map((d) => d.kind)).toEqual(['innsovning', 'oppvaakning']);
		expect(SLEEP_DISTURBANCES.map((d) => d.kind)).toEqual([...SLEEP_DISTURBANCE_KINDS]);
	});

	it('har label, beskrivelse og emoji på alle', () => {
		for (const d of SLEEP_DISTURBANCES) {
			expect(d.label.length, d.kind).toBeGreaterThan(0);
			expect(d.description.length, d.kind).toBeGreaterThan(0);
			expect(d.emoji.length, d.kind).toBeGreaterThan(0);
		}
	});
});

describe('disturbanceMeta', () => {
	it('slår opp på kind', () => {
		expect(disturbanceMeta('oppvaakning').description).toBe('Våknet og fikk ikke sove igjen');
	});
});

describe('isSleepDisturbanceKind', () => {
	it('godtar bare de to', () => {
		expect(isSleepDisturbanceKind('innsovning')).toBe(true);
		expect(isSleepDisturbanceKind('oppvaakning')).toBe(true);
		expect(isSleepDisturbanceKind('nap')).toBe(false);
		expect(isSleepDisturbanceKind(null)).toBe(false);
	});
});

describe('nightKeyForTime', () => {
	it('nøkler på datoen du våkner, ikke datoen du la deg', () => {
		// Konvensjonen fra buildSleepNightSeries: night.end ?? night.start.
		// 23:30 norsk den 3. → natta som ender 4.
		expect(nightKeyForTime('2026-08-03T21:30:00.000Z')).toBe('2026-08-04');
		// 03:00 norsk den 4. → samme natt.
		expect(nightKeyForTime('2026-08-04T01:00:00.000Z')).toBe('2026-08-04');
	});

	it('legger en morgenrapport på natta som nettopp endte', () => {
		// Logger du kl. 08 om at du lå våken, gjelder det natta du våknet fra.
		expect(nightKeyForTime('2026-08-04T06:00:00.000Z')).toBe('2026-08-04');
	});

	it('setter kveldsgrensa på 18 norsk tid', () => {
		// 17:59 norsk → fortsatt «i dag». 18:00 → natta som kommer.
		expect(nightKeyForTime('2026-08-03T15:59:00.000Z')).toBe('2026-08-03');
		expect(nightKeyForTime('2026-08-03T16:00:00.000Z')).toBe('2026-08-04');
	});

	it('bruker Osloklokka, også over månedsskifte', () => {
		// 22:30 norsk den 31. juli → natta som ender 1. august.
		expect(nightKeyForTime('2026-07-31T20:30:00.000Z')).toBe('2026-08-01');
	});

	it('håndterer vintertid (UTC+1)', () => {
		// 18:30 norsk er 17:30Z om vinteren → natta som kommer.
		expect(nightKeyForTime('2026-01-15T17:30:00.000Z')).toBe('2026-01-16');
		expect(nightKeyForTime('2026-01-15T16:30:00.000Z')).toBe('2026-01-15');
	});

	it('godtar Date og gir null for tull', () => {
		expect(nightKeyForTime(new Date('2026-08-04T01:00:00.000Z'))).toBe('2026-08-04');
		expect(nightKeyForTime('tull')).toBeNull();
	});
});

describe('groupDisturbancesByNight', () => {
	it('samler kveld og natt på samme natt', () => {
		const nights = groupDisturbancesByNight([
			entry({ id: 'kveld', timestamp: '2026-08-03T21:30:00.000Z', kind: 'innsovning' }),
			entry({ id: 'natt', timestamp: '2026-08-04T01:00:00.000Z', kind: 'oppvaakning' })
		]);
		expect(nights).toHaveLength(1);
		expect(nights[0].nightKey).toBe('2026-08-04');
		expect(nights[0].innsovning).toBe(1);
		expect(nights[0].oppvaakning).toBe(1);
	});

	it('sorterer nyeste natt først, og innslag kronologisk innenfor natta', () => {
		const nights = groupDisturbancesByNight([
			entry({ id: 'ny', timestamp: '2026-08-05T01:00:00.000Z' }),
			entry({ id: 'sen', timestamp: '2026-08-04T02:00:00.000Z' }),
			entry({ id: 'tidlig', timestamp: '2026-08-03T21:00:00.000Z' })
		]);
		expect(nights.map((n) => n.nightKey)).toEqual(['2026-08-05', '2026-08-04']);
		// 21:00 den 3. og 02:00 den 4. er samme natt, tidligst først.
		expect(nights[1].entries.map((e) => e.id)).toEqual(['tidlig', 'sen']);
	});

	it('summerer oppgitte minutter', () => {
		const nights = groupDisturbancesByNight([
			entry({ id: 'a', timestamp: '2026-08-03T21:00:00.000Z', awakeMinutes: 45 }),
			entry({ id: 'b', timestamp: '2026-08-04T02:00:00.000Z', awakeMinutes: 50 })
		]);
		expect(nights[0].awakeMinutes).toBe(95);
	});

	it('skiller «vet ikke» fra 0 minutter', () => {
		// null betyr at ingen oppgav noe. 0 betyr at man våknet og sov med en gang.
		const ukjent = groupDisturbancesByNight([entry({ awakeMinutes: null })]);
		expect(ukjent[0].awakeMinutes).toBeNull();

		const null_minutter = groupDisturbancesByNight([entry({ awakeMinutes: 0 })]);
		expect(null_minutter[0].awakeMinutes).toBe(0);
	});

	it('summerer bare dem som oppgav minutter', () => {
		const nights = groupDisturbancesByNight([
			entry({ id: 'a', timestamp: '2026-08-03T21:00:00.000Z', awakeMinutes: 45 }),
			entry({ id: 'b', timestamp: '2026-08-04T02:00:00.000Z', awakeMinutes: null })
		]);
		expect(nights[0].awakeMinutes).toBe(45);
		expect(nights[0].entries).toHaveLength(2);
	});

	it('hopper over ugyldige tidspunkt', () => {
		const nights = groupDisturbancesByNight([entry({ timestamp: 'tull' }), entry({ id: 'ok' })]);
		expect(nights).toHaveLength(1);
		expect(nights[0].entries[0].id).toBe('ok');
	});

	it('muterer ikke inn-arrayen', () => {
		const entries = [
			entry({ id: 'sen', timestamp: '2026-08-04T02:00:00.000Z' }),
			entry({ id: 'tidlig', timestamp: '2026-08-03T21:00:00.000Z' })
		];
		groupDisturbancesByNight(entries);
		expect(entries.map((e) => e.id)).toEqual(['sen', 'tidlig']);
	});

	it('gir tom liste for ingen innslag', () => {
		expect(groupDisturbancesByNight([])).toEqual([]);
	});
});

describe('describeDisturbanceWindow', () => {
	it('setter sammen netter og minutter', () => {
		const nights = groupDisturbancesByNight([
			entry({ id: 'a', timestamp: '2026-08-03T21:00:00.000Z', awakeMinutes: 45 }),
			entry({ id: 'b', timestamp: '2026-08-04T22:00:00.000Z', awakeMinutes: 50 })
		]);
		expect(describeDisturbanceWindow(nights, 'siste uke')).toBe(
			'2 netter med urolig søvn siste uke, 95 min våken.'
		);
	});

	it('bøyer natt i entall', () => {
		const nights = groupDisturbancesByNight([entry({ awakeMinutes: 30 })]);
		expect(describeDisturbanceWindow(nights, 'siste uke')).toBe(
			'1 natt med urolig søvn siste uke, 30 min våken.'
		);
	});

	it('utelater minutter når ingen er oppgitt', () => {
		const nights = groupDisturbancesByNight([entry({ awakeMinutes: null })]);
		expect(describeDisturbanceWindow(nights, 'siste uke')).toBe('1 natt med urolig søvn siste uke.');
	});

	it('gir null for ingen netter', () => {
		expect(describeDisturbanceWindow([], 'siste uke')).toBeNull();
	});
});
