import { describe, it, expect } from 'vitest';
import {
	averagePerLoggedDay,
	groupByDay,
	osloDateKey,
	osloTimeLabel,
	summarizeDay,
	sumEntries,
	type LoggedEntry
} from './day-summary';

function entry(overrides: Partial<LoggedEntry> = {}): LoggedEntry {
	return {
		id: 'a',
		timestamp: '2026-08-02T10:00:00.000Z',
		label: 'To knekkebrød med egg',
		macros: { kcal: 158, proteinG: 8.9, carbsG: 13.6, fatG: 6.5 },
		confidence: 0.8,
		imageUrl: null,
		...overrides
	};
}

describe('osloDateKey', () => {
	it('bruker Osloklokka, ikke UTC', () => {
		// 01:30 UTC er 03:30 norsk sommertid — samme dato. Men 23:30 UTC er
		// 01:30 NESTE dag i Oslo, og et kveldsmåltid skal ligge på riktig dag.
		expect(osloDateKey('2026-08-02T23:30:00.000Z')).toBe('2026-08-03');
		expect(osloDateKey('2026-08-02T10:00:00.000Z')).toBe('2026-08-02');
	});

	it('håndterer vintertid (UTC+1)', () => {
		expect(osloDateKey('2026-01-15T23:30:00.000Z')).toBe('2026-01-16');
		expect(osloDateKey('2026-01-15T22:59:00.000Z')).toBe('2026-01-15');
	});

	it('godtar Date like godt som streng', () => {
		expect(osloDateKey(new Date('2026-08-02T10:00:00.000Z'))).toBe('2026-08-02');
	});

	it('gir tom streng for ugyldig tidspunkt', () => {
		expect(osloDateKey('tull')).toBe('');
	});
});

describe('osloTimeLabel', () => {
	it('viser klokkeslettet i norsk tid', () => {
		expect(osloTimeLabel('2026-08-02T10:00:00.000Z')).toBe('12:00');
	});

	it('gir tom streng for ugyldig tidspunkt', () => {
		expect(osloTimeLabel('tull')).toBe('');
	});
});

describe('sumEntries', () => {
	it('summerer og runder', () => {
		expect(sumEntries([entry(), entry({ id: 'b' })])).toEqual({
			kcal: 316,
			proteinG: 17.8,
			carbsG: 27.2,
			fatG: 13
		});
	});

	it('gir nuller for tom dag', () => {
		expect(sumEntries([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
	});
});

describe('summarizeDay', () => {
	it('sorterer innslagene kronologisk', () => {
		const summary = summarizeDay('2026-08-02', [
			entry({ id: 'sent', timestamp: '2026-08-02T16:00:00.000Z' }),
			entry({ id: 'tidlig', timestamp: '2026-08-02T06:00:00.000Z' })
		]);
		expect(summary.entries.map((e) => e.id)).toEqual(['tidlig', 'sent']);
	});

	it('muterer ikke inn-arrayen', () => {
		const entries = [
			entry({ id: 'sent', timestamp: '2026-08-02T16:00:00.000Z' }),
			entry({ id: 'tidlig', timestamp: '2026-08-02T06:00:00.000Z' })
		];
		summarizeDay('2026-08-02', entries);
		expect(entries.map((e) => e.id)).toEqual(['sent', 'tidlig']);
	});

	it('regner andel av dagsmålet', () => {
		const summary = summarizeDay('2026-08-02', [entry({ macros: { kcal: 1000, proteinG: 50, carbsG: 100, fatG: 30 } })], {
			kcal: 2000,
			proteinG: 100
		});
		expect(summary.kcalShare).toBe(0.5);
		expect(summary.proteinShare).toBe(0.5);
	});

	it('lar andelen overstige 1 uten å klemme', () => {
		// Å skjule at man er over målet gjør tallet ubrukelig.
		const summary = summarizeDay('2026-08-02', [entry({ macros: { kcal: 3000, proteinG: 0, carbsG: 0, fatG: 0 } })], { kcal: 2000 });
		expect(summary.kcalShare).toBe(1.5);
	});

	it('gir null andel når målet ikke er satt, er null eller er 0', () => {
		const entries = [entry()];
		expect(summarizeDay('2026-08-02', entries).kcalShare).toBeNull();
		expect(summarizeDay('2026-08-02', entries, { kcal: null }).kcalShare).toBeNull();
		expect(summarizeDay('2026-08-02', entries, { kcal: 0 }).kcalShare).toBeNull();
	});

	it('viser en tom dag som 0 framfor ingenting', () => {
		const summary = summarizeDay('2026-08-02', []);
		expect(summary.totals.kcal).toBe(0);
		expect(summary.summaryLine).toBe('0 kcal · 0 g protein');
	});
});

describe('groupByDay', () => {
	it('grupperer på Oslo-dato med nyeste dag først', () => {
		const groups = groupByDay([
			entry({ id: 'a', timestamp: '2026-08-01T10:00:00.000Z' }),
			entry({ id: 'b', timestamp: '2026-08-02T10:00:00.000Z' }),
			entry({ id: 'c', timestamp: '2026-08-02T18:00:00.000Z' })
		]);
		expect(groups.map((g) => g.date)).toEqual(['2026-08-02', '2026-08-01']);
		expect(groups[0].entries).toHaveLength(2);
	});

	it('legger et sent kveldsmåltid på neste dag, slik Osloklokka sier', () => {
		const groups = groupByDay([entry({ timestamp: '2026-08-02T23:30:00.000Z' })]);
		expect(groups[0].date).toBe('2026-08-03');
	});

	it('hopper over innslag med ugyldig tidspunkt', () => {
		const groups = groupByDay([entry({ timestamp: 'tull' }), entry({ id: 'ok' })]);
		expect(groups).toHaveLength(1);
		expect(groups[0].entries[0].id).toBe('ok');
	});

	it('gir tom liste for ingen innslag', () => {
		expect(groupByDay([])).toEqual([]);
	});
});

describe('averagePerLoggedDay', () => {
	it('deler på loggede dager, ikke kalenderdager', () => {
		// To dager logget med 1000 kcal hver gir 1000 i snitt — ikke 285 fordi
		// vinduet var sju dager. Et lavt snitt som skyldes glemt logging er verre
		// enn ingen tall.
		const result = averagePerLoggedDay([
			entry({ timestamp: '2026-08-01T10:00:00.000Z', macros: { kcal: 1000, proteinG: 50, carbsG: 0, fatG: 0 } }),
			entry({ timestamp: '2026-08-05T10:00:00.000Z', macros: { kcal: 1000, proteinG: 70, carbsG: 0, fatG: 0 } })
		]);
		expect(result.loggedDays).toBe(2);
		expect(result.perDay.kcal).toBe(1000);
		expect(result.perDay.proteinG).toBe(60);
	});

	it('summerer flere måltid på samme dag før snittet', () => {
		const result = averagePerLoggedDay([
			entry({ timestamp: '2026-08-01T08:00:00.000Z', macros: { kcal: 400, proteinG: 20, carbsG: 0, fatG: 0 } }),
			entry({ timestamp: '2026-08-01T18:00:00.000Z', macros: { kcal: 600, proteinG: 30, carbsG: 0, fatG: 0 } })
		]);
		expect(result.loggedDays).toBe(1);
		expect(result.perDay.kcal).toBe(1000);
	});

	it('gir 0 dager og nuller for tom logg', () => {
		expect(averagePerLoggedDay([])).toEqual({
			loggedDays: 0,
			perDay: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
		});
	});
});
