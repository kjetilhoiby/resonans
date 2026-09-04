import { describe, it, expect } from 'vitest';
import {
	DEFAULT_WINDOW_MINUTES,
	MAX_WINDOW_MINUTES,
	resolveDiagnosticsWindow,
	summarizeCronRuns,
	summarizeJobCounts,
	toPublicCronRun,
	type CronExecutionRow
} from './diagnostics';

const NOW = new Date('2026-09-04T08:00:00Z');

function row(overrides: Partial<CronExecutionRow> = {}): CronExecutionRow {
	return {
		jobPath: '/api/cron/aggregate',
		status: 'success',
		durationMs: 120,
		executedAt: new Date('2026-09-04T07:59:00Z'),
		error: 'rå feiltekst med /hjemme/sti og id 42',
		resultSummary: { accountNames: ['Brukskonto Kjetil', 'Sparekonto'] },
		...overrides
	};
}

describe('toPublicCronRun', () => {
	it('slipper gjennom bare de fire trygge feltene', () => {
		const pub = toPublicCronRun(row());
		expect(Object.keys(pub).sort()).toEqual([
			'durationMs',
			'executedAt',
			'failed',
			'path',
			'status'
		]);
	});

	// Dette er hele grunnen til at modulen finnes. Feiler den, lekker et
	// uautentisert endepunkt brukerdata.
	it('lekker ALDRI feiltekst eller resultatsammendrag', () => {
		const serialisert = JSON.stringify(toPublicCronRun(row()));
		expect(serialisert).not.toContain('rå feiltekst');
		expect(serialisert).not.toContain('/hjemme/sti');
		expect(serialisert).not.toContain('Brukskonto');
		expect(serialisert).not.toContain('Sparekonto');
		expect(serialisert).not.toContain('accountNames');
	});

	// Et felt lagt til i cron_executions senere skal IKKE følge med ut av seg
	// selv — det er forskjellen på hviteliste og spread.
	it('tar ikke med felt som kommer til senere', () => {
		const medNyttFelt = {
			...row(),
			nyttFeltNoenLaTilSenere: 'hemmelig'
		} as CronExecutionRow;
		expect(JSON.stringify(toPublicCronRun(medNyttFelt))).not.toContain('hemmelig');
	});

	it('sier at kjøringen feilet uten å si hvordan', () => {
		expect(toPublicCronRun(row({ status: 'error' })).failed).toBe(true);
		expect(toPublicCronRun(row({ status: 'partial' })).failed).toBe(true);
		expect(toPublicCronRun(row({ status: 'success' })).failed).toBe(false);
	});

	it('beholder null-varighet framfor å gjette en 0', () => {
		expect(toPublicCronRun(row({ durationMs: null })).durationMs).toBeNull();
	});
});

describe('resolveDiagnosticsWindow', () => {
	it('default er en time bakover fra nå', () => {
		const w = resolveDiagnosticsWindow({}, NOW);
		expect(w.minutes).toBe(DEFAULT_WINDOW_MINUTES);
		expect(w.toMs).toBe(NOW.getTime());
		expect(w.fromMs).toBe(NOW.getTime() - 60 * 60_000);
		expect(w.clamped).toBe(false);
	});

	it('until flytter vinduet bakover i tid — «hva skjedde 12:48 i går»', () => {
		const w = resolveDiagnosticsWindow(
			{ until: '2026-09-03T13:00:00Z', minutes: '30' },
			NOW
		);
		expect(new Date(w.toMs).toISOString()).toBe('2026-09-03T13:00:00.000Z');
		expect(new Date(w.fromMs).toISOString()).toBe('2026-09-03T12:30:00.000Z');
	});

	it('kapper vinduet på et døgn, og SIER at det ble kappet', () => {
		const w = resolveDiagnosticsWindow({ minutes: '100000' }, NOW);
		expect(w.minutes).toBe(MAX_WINDOW_MINUTES);
		expect(w.clamped).toBe(true);
	});

	// Et diagnoseverktøy man skriver for hånd skal ikke straffe en skrivefeil.
	it('faller til defaulten på søppel framfor å kaste', () => {
		for (const minutes of ['', 'tjue', '-5', '0', null]) {
			expect(resolveDiagnosticsWindow({ minutes }, NOW).minutes).toBe(DEFAULT_WINDOW_MINUTES);
		}
		expect(resolveDiagnosticsWindow({ until: 'i går' }, NOW).toMs).toBe(NOW.getTime());
	});

	it('clamped er false når brukeren ikke ba om for mye', () => {
		expect(resolveDiagnosticsWindow({ minutes: '30' }, NOW).clamped).toBe(false);
		expect(resolveDiagnosticsWindow({ minutes: 'tull' }, NOW).clamped).toBe(false);
	});
});

describe('summarizeCronRuns', () => {
	const runs = [
		toPublicCronRun(row({ jobPath: '/api/cron/a', durationMs: 100 })),
		toPublicCronRun(row({ jobPath: '/api/cron/b', durationMs: 9000 })),
		toPublicCronRun(row({ jobPath: '/api/cron/c', durationMs: 50, status: 'error' })),
		toPublicCronRun(row({ jobPath: '/api/cron/d', durationMs: null }))
	];

	it('teller per status', () => {
		expect(summarizeCronRuns(runs).byStatus).toEqual({ success: 3, error: 1 });
	});

	it('setter den tregeste først — det er den man leter etter', () => {
		const s = summarizeCronRuns(runs);
		expect(s.slowest[0].path).toBe('/api/cron/b');
		expect(s.slowest[0].durationMs).toBe(9000);
	});

	it('holder null-varighet utenfor tregest-lista framfor å sortere den som 0', () => {
		expect(summarizeCronRuns(runs).slowest.map((r) => r.path)).not.toContain('/api/cron/d');
	});

	it('summerer varigheten og teller alle radene', () => {
		const s = summarizeCronRuns(runs);
		expect(s.total).toBe(4);
		expect(s.totalDurationMs).toBe(9150);
	});

	it('takler et tomt vindu', () => {
		expect(summarizeCronRuns([])).toEqual({
			total: 0,
			byStatus: {},
			slowest: [],
			totalDurationMs: 0
		});
	});
});

describe('summarizeJobCounts', () => {
	it('teller per status og totalt', () => {
		expect(
			summarizeJobCounts([
				{ status: 'queued', count: 2 },
				{ status: 'failed', count: 1 }
			])
		).toEqual({ byStatus: { queued: 2, failed: 1 }, total: 3 });
	});

	it('gir tomt for ingen jobber', () => {
		expect(summarizeJobCounts([])).toEqual({ byStatus: {}, total: 0 });
	});
});
