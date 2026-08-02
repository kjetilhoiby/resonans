import { describe, it, expect } from 'vitest';
import {
	presentSignal,
	rankSignalsForOverview,
	type SignalLatest,
	type PresentedSignal
} from './signal-presentation';

function latest(overrides: Partial<SignalLatest> = {}): SignalLatest {
	return {
		valueNumber: null,
		valueText: null,
		valueBool: null,
		severity: 'info',
		confidence: '0.8',
		observedAt: '2026-08-01T06:00:00Z',
		context: {},
		...overrides
	};
}

describe('presentSignal — health_effort_vs_threshold', () => {
	it('leser terskelen som positiv når den er passert', () => {
		const result = presentSignal(
			'health_effort_vs_threshold',
			latest({ valueText: 'over_terskel', valueNumber: 1.2, severity: 'info' })
		);
		expect(result?.title).toBe('Trening mot vektterskel');
		expect(result?.sentence).toBe('Du trener over terskelen vekten din reagerer på.');
		expect(result?.tone).toBe('positiv');
		expect(result?.crossLinks).toEqual(['Trening', 'Ernæring']);
	});

	it('viser hvor langt unna terskelen man ligger, i prosent', () => {
		const result = presentSignal(
			'health_effort_vs_threshold',
			latest({ valueText: 'under_terskel', valueNumber: 0.72, severity: 'medium' })
		);
		expect(result?.sentence).toContain('72 %');
		expect(result?.tone).toBe('varsel');
	});

	it('sier fra når grunnlaget mangler i stedet for å pynte på det', () => {
		const result = presentSignal('health_effort_vs_threshold', latest({ valueText: 'ukjent' }));
		expect(result?.sentence).toBe('Ikke nok data til å anslå effort-terskelen ennå.');
	});
});

describe('presentSignal — resting_hr_elevated_7d', () => {
	it('forklarer forhøyet sovepuls med begge tallene', () => {
		const result = presentSignal(
			'resting_hr_elevated_7d',
			latest({
				valueNumber: 3.2,
				severity: 'medium',
				context: { recentAvg: 55, baselineAvg: 51.8 }
			})
		);
		expect(result?.sentence).toBe('Sovepulsen er 3,2 slag over vanlig (55 mot 52).');
		expect(result?.tone).toBe('varsel');
	});

	it('behandler lavere hvilepuls som positivt, ikke som avvik', () => {
		const result = presentSignal(
			'resting_hr_elevated_7d',
			latest({ valueNumber: -2, severity: 'info', context: { recentAvg: 50, baselineAvg: 52 } })
		);
		expect(result?.sentence).toContain('under vanlig');
		expect(result?.tone).toBe('positiv');
	});

	it('sier «det vanlige» innenfor terskelen', () => {
		const result = presentSignal(
			'resting_hr_elevated_7d',
			latest({ valueNumber: 0.4, context: { recentAvg: 52, baselineAvg: 51.6 } })
		);
		expect(result?.sentence).toBe('Sovepulsen ligger på det vanlige (52 slag).');
	});
});

describe('presentSignal — sleep_powernaps_7d', () => {
	it('kobler naps til korte netter når det finnes', () => {
		const result = presentSignal(
			'sleep_powernaps_7d',
			latest({ valueNumber: 3, context: { shortNightNapCount: 2 } })
		);
		expect(result?.sentence).toBe('3 powernaps denne uka, 2 av dem etter en kort natt.');
		expect(result?.crossLinks).toEqual(['Søvn', 'Egenfrekvens']);
	});

	it('bøyer entall riktig', () => {
		const result = presentSignal('sleep_powernaps_7d', latest({ valueNumber: 1, context: {} }));
		expect(result?.sentence).toBe('1 powernap denne uka.');
	});

	it('sier ingen i stedet for «0 powernaps»', () => {
		const result = presentSignal('sleep_powernaps_7d', latest({ valueNumber: 0 }));
		expect(result?.sentence).toBe('Ingen powernaps denne uka.');
	});
});

describe('presentSignal — evening_screen_work_7d', () => {
	it('forbinder skjermtid og søvn', () => {
		const result = presentSignal(
			'evening_screen_work_7d',
			latest({
				valueNumber: 312,
				severity: 'medium',
				context: { eveningDays: 4, totalEveningMinutes: 312 }
			})
		);
		expect(result?.sentence).toBe('4 kvelder med skjermarbeid etter 17, 5,2 timer til sammen.');
		expect(result?.crossLinks).toEqual(['Skjermtid', 'Søvn']);
	});

	it('bøyer entall riktig', () => {
		const result = presentSignal(
			'evening_screen_work_7d',
			latest({ context: { eveningDays: 1, totalEveningMinutes: 60 } })
		);
		expect(result?.sentence).toContain('1 kveld med');
	});
});

describe('presentSignal — training_balance', () => {
	it('bruker nudge-teksten ordrett når den finnes', () => {
		const result = presentSignal(
			'training_balance',
			latest({
				valueNumber: 62,
				context: { nudge: { kind: 'styrke', message: 'Ingen styrkeøkt denne uka — legg inn én.' } }
			})
		);
		expect(result?.sentence).toBe('Ingen styrkeøkt denne uka — legg inn én.');
	});

	it('faller tilbake på scoren når nudge mangler', () => {
		const result = presentSignal('training_balance', latest({ valueNumber: 81, context: {} }));
		expect(result?.sentence).toBe('Balansescore 81 av 100 over fire uker.');
	});
});

describe('presentSignal — egenfrekvens_trend_7d', () => {
	it('beskriver retning med begge snittene', () => {
		const result = presentSignal(
			'egenfrekvens_trend_7d',
			latest({
				valueNumber: 2.8,
				severity: 'medium',
				context: { recentAvg: 2.8, baselineAvg: 3.4, direction: 'nedgang' }
			})
		);
		expect(result?.sentence).toBe('Nivået er i nedgang: 2,8 mot 3,4 i snitt.');
		expect(result?.tone).toBe('varsel');
	});

	it('regner oppgang som positivt uansett severity', () => {
		const result = presentSignal(
			'egenfrekvens_trend_7d',
			latest({ context: { recentAvg: 4.1, baselineAvg: 3.4, direction: 'oppgang' } })
		);
		expect(result?.tone).toBe('positiv');
	});

	it('formulerer stabilt nivå uten retningsord', () => {
		const result = presentSignal(
			'egenfrekvens_trend_7d',
			latest({ context: { recentAvg: 3.4, baselineAvg: 3.4, direction: 'stabil' } })
		);
		expect(result?.sentence).toBe('Nivået ligger stabilt på 3,4 av 5.');
	});
});

describe('presentSignal — mangler og ukjente typer', () => {
	it('returnerer null uten måling', () => {
		expect(presentSignal('training_balance', null)).toBeNull();
	});

	it('returnerer null når setningen ikke kan bygges', () => {
		// Ingen recentAvg → ingenting å si.
		expect(presentSignal('egenfrekvens_trend_7d', latest({ context: {} }))).toBeNull();
	});

	it('lar et ukjent signal vises stygt heller enn å forsvinne stille', () => {
		const result = presentSignal('nytt_signal_ingen_kjenner', latest({ valueText: 'noe skjedde' }));
		expect(result?.title).toBe('nytt_signal_ingen_kjenner');
		expect(result?.sentence).toBe('noe skjedde');
		expect(result?.crossLinks).toEqual(['Helse']);
	});

	it('utleder tone fra severity når definisjonen ikke overstyrer', () => {
		const result = presentSignal('sleep_powernaps_7d', latest({ valueNumber: 5, severity: 'high' }));
		expect(result?.tone).toBe('kritisk');
	});
});

describe('rankSignalsForOverview', () => {
	function signal(overrides: Partial<PresentedSignal>): PresentedSignal {
		return {
			signalType: 't',
			title: 'T',
			sentence: 's',
			tone: 'nøytral',
			severity: 'info',
			crossLinks: ['Helse'],
			observedAt: '2026-08-01T06:00:00Z',
			...overrides
		};
	}
	const now = new Date('2026-08-02T06:00:00Z');

	it('sorterer mest alvorlige først', () => {
		const ranked = rankSignalsForOverview(
			[
				signal({ signalType: 'lav', severity: 'low' }),
				signal({ signalType: 'kritisk', severity: 'high' }),
				signal({ signalType: 'medium', severity: 'medium' })
			],
			{ now }
		);
		expect(ranked.map((s) => s.signalType)).toEqual(['kritisk', 'medium', 'lav']);
	});

	it('bruker ferskhet som tiebreak innenfor samme alvorlighet', () => {
		const ranked = rankSignalsForOverview(
			[
				signal({ signalType: 'gammel', severity: 'high', observedAt: '2026-07-20T06:00:00Z' }),
				signal({ signalType: 'ny', severity: 'high', observedAt: '2026-08-01T06:00:00Z' })
			],
			{ now }
		);
		expect(ranked.map((s) => s.signalType)).toEqual(['ny', 'gammel']);
	});

	it('filtrerer bort gamle info-signaler, men beholder gamle varsler', () => {
		const ranked = rankSignalsForOverview(
			[
				signal({ signalType: 'gammel-info', severity: 'info', observedAt: '2026-07-01T06:00:00Z' }),
				signal({ signalType: 'gammel-høy', severity: 'high', observedAt: '2026-07-01T06:00:00Z' })
			],
			{ now }
		);
		expect(ranked.map((s) => s.signalType)).toEqual(['gammel-høy']);
	});

	it('beholder ferske info-signaler', () => {
		const ranked = rankSignalsForOverview(
			[signal({ signalType: 'fersk-info', severity: 'info', observedAt: '2026-08-01T06:00:00Z' })],
			{ now }
		);
		expect(ranked).toHaveLength(1);
	});

	it('begrenser antallet', () => {
		const many = Array.from({ length: 9 }, (_, i) =>
			signal({ signalType: `s${i}`, severity: 'high' })
		);
		expect(rankSignalsForOverview(many, { now })).toHaveLength(5);
		expect(rankSignalsForOverview(many, { now, limit: 3 })).toHaveLength(3);
	});
});
