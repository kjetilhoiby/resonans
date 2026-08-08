import { describe, it, expect } from 'vitest';
import {
	summarizeEgenfrekvensForChat,
	MAX_DAYS,
	MAX_NOTE_CHARS,
	type EgenfrekvensSummaryInput
} from './egenfrekvens-summary';

function slot(level: number, balance: number, note: string | null = null) {
	return {
		level,
		balance,
		note,
		reflectionSynthesis: null,
		timestamp: '2026-08-07T07:30:00Z'
	};
}

function point(day: string, overrides: Partial<EgenfrekvensSummaryInput['points'][number]> = {}) {
	return {
		day,
		count: 2,
		balance: -3,
		thoughts: 2,
		feelings: 2,
		actions: 3,
		note: null,
		reflectionSynthesis: null,
		extreme: false,
		slots: {},
		...overrides
	};
}

function input(overrides: Partial<EgenfrekvensSummaryInput> = {}): EgenfrekvensSummaryInput {
	const points = [point('2026-08-07'), point('2026-08-06', { balance: 1 })];
	return {
		rangeDays: 30,
		latest: points[0],
		points,
		stats: {
			count: points.length,
			avgBalance: -1,
			avgLevel: 3.2,
			avgThoughts: 2.5,
			avgFeelings: 2,
			avgActions: 3,
			avgLevelBySlot: { natt: 2.5, morgen: 2, dag: null, arbeidsdag: 3.5, ettermiddag: null, kveld: 4 },
			extremeDays: 1
		},
		streakDays: 5,
		...overrides
	};
}

describe('summarizeEgenfrekvensForChat — recent', () => {
	it('gir balansetallet brukerens egen merkelapp', () => {
		const summary = summarizeEgenfrekvensForChat(input(), 'recent');
		expect(summary.days?.[0]).toMatchObject({ balance: -3, balanceLabel: 'Underskudd' });
		expect(summary.days?.[1]).toMatchObject({ balance: 1, balanceLabel: 'Litt lettere' });
	});

	it('klipper lange notater og sier at det står mer', () => {
		const long = 'a'.repeat(MAX_NOTE_CHARS + 50);
		const summary = summarizeEgenfrekvensForChat(
			input({ points: [point('2026-08-07', { note: long })] }),
			'recent'
		);
		expect(summary.days?.[0].noteTruncated).toBe(true);
		expect(summary.days?.[0].note?.length).toBe(MAX_NOTE_CHARS + 1); // + ellipsen
	});

	it('lar korte notater stå urørt', () => {
		const summary = summarizeEgenfrekvensForChat(
			input({ points: [point('2026-08-07', { note: 'tung morgen, bedre etter en tur' })] }),
			'recent'
		);
		expect(summary.days?.[0].note).toBe('tung morgen, bedre etter en tur');
		expect(summary.days?.[0].noteTruncated).toBe(false);
	});

	it('klipper til to uker og sier det', () => {
		const points = Array.from({ length: MAX_DAYS + 4 }, (_, i) =>
			point(`2026-07-${String(i + 1).padStart(2, '0')}`)
		);
		const summary = summarizeEgenfrekvensForChat(input({ points }), 'recent');
		expect(summary.days).toHaveLength(MAX_DAYS);
		expect(summary.truncated).toBe(true);
	});

	it('bærer streak og ytterdager som dekning', () => {
		const summary = summarizeEgenfrekvensForChat(input(), 'recent');
		expect(summary.coverage).toMatchObject({ streakDays: 5, extremeDays: 1, daysWithCheckin: 2 });
	});
});

describe('summarizeEgenfrekvensForChat — trend', () => {
	it('viser snitt per periode av døgnet og utelater periodene uten innsjekk', () => {
		const summary = summarizeEgenfrekvensForChat(input(), 'trend');
		expect(summary.byPeriod?.map((p) => p.slot)).toEqual(['natt', 'morgen', 'arbeidsdag', 'kveld']);
		expect(summary.byPeriod?.find((p) => p.slot === 'kveld')?.avgLevel).toBe(4);
	});

	it('merker snittbalansen med den nærmeste merkelappen på skalaen', () => {
		const summary = summarizeEgenfrekvensForChat(input({ stats: { ...input().stats, avgBalance: -2.4 } }), 'trend');
		expect(summary.averages?.balance).toBe(-2.4);
		expect(summary.averages?.balanceLabel).toBe('Sliten');
	});

	it('bruker dagens høyeste slot-nivå, ikke snittet av dem', () => {
		const summary = summarizeEgenfrekvensForChat(
			input({
				points: [point('2026-08-07', { slots: { morgen: slot(2, -3), kveld: slot(5, 3) } })]
			}),
			'trend'
		);
		expect(summary.dayLevels?.[0].level).toBe(5);
	});

	it('gir null nivå for en dag uten slot-registreringer', () => {
		const summary = summarizeEgenfrekvensForChat(input(), 'trend');
		expect(summary.dayLevels?.[0].level).toBeNull();
	});
});

describe('summarizeEgenfrekvensForChat — latest', () => {
	it('bryter siste dag ned per periode', () => {
		const summary = summarizeEgenfrekvensForChat(
			input({
				latest: point('2026-08-07', {
					slots: { morgen: slot(2, -3, 'tungt'), kveld: slot(4, 2) }
				})
			}),
			'latest'
		);
		expect(summary.latest?.slots).toHaveLength(2);
		expect(summary.latest?.slots?.[0]).toMatchObject({ slot: 'morgen', level: 2, balanceLabel: 'Underskudd', note: 'tungt' });
	});

	it('tåler at det ikke finnes noen innsjekk', () => {
		const summary = summarizeEgenfrekvensForChat(
			input({ latest: null, points: [], stats: { ...input().stats, count: 0 }, streakDays: 0 }),
			'latest'
		);
		expect(summary.latest).toBeNull();
		expect(summary.coverage.daysWithCheckin).toBe(0);
	});
});
