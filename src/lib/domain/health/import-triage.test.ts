import { describe, it, expect } from 'vitest';
import {
	MAX_RUN_SEC_PER_KM,
	MIN_PACE_AXIS_METERS,
	riegelSeconds,
	triageCandidate,
	triageReport,
	type PaceReference,
	type TriageCandidate
} from './import-triage';

/** Brukerens egen mil: 52:00 over 10 km. */
const PR: PaceReference = { distanceMeters: 10000, seconds: 52 * 60 };

function candidate(over: Partial<TriageCandidate> = {}): TriageCandidate {
	return {
		id: 'a1',
		date: '2015-05-01',
		name: 'Løpetur',
		sportType: 'running',
		distanceMeters: 8000,
		elapsedSeconds: 45 * 60,
		movingSeconds: 45 * 60,
		...over
	};
}

describe('riegelSeconds', () => {
	it('gir referansen selv på referansedistansen', () => {
		expect(riegelSeconds(PR, 10000)).toBeCloseTo(52 * 60, 6);
	});

	it('skalerer opp raskere enn lineært', () => {
		const half = riegelSeconds(PR, 5000);
		expect(half).toBeLessThan(26 * 60);
		expect(half).toBeGreaterThan(24 * 60);
	});
});

describe('for-rask', () => {
	it('flagger et tempo raskere enn brukerens egen kurve', () => {
		// 10,59 km på 4:26/km = 2818 s, mot en kurve som tilsier ~3320 s.
		const findings = triageCandidate(
			candidate({ distanceMeters: 10590, elapsedSeconds: 2818, movingSeconds: 2818 }),
			{ paceReference: PR }
		);
		const fast = findings.find((f) => f.axis === 'for-rask');
		expect(fast).toBeDefined();
		expect(fast?.reason).toContain('4:26/km');
	});

	it('lar en normal økt stå', () => {
		const findings = triageCandidate(
			candidate({ distanceMeters: 8000, elapsedSeconds: 48 * 60, movingSeconds: 48 * 60 }),
			{ paceReference: PR }
		);
		expect(findings).toEqual([]);
	});

	it('dømmer IKKE korte distanser — Riegel gjelder ikke der', () => {
		// 400 m på 80 s er raskt, men kurven ekstrapolert dit spår for tregt.
		const findings = triageCandidate(
			candidate({
				distanceMeters: MIN_PACE_AXIS_METERS - 100,
				elapsedSeconds: 240,
				movingSeconds: 240
			}),
			{ paceReference: PR }
		);
		expect(findings.some((f) => f.axis === 'for-rask')).toBe(false);
	});

	it('dømmer ikke sykkel — farten er terreng, vind og motor', () => {
		const findings = triageCandidate(
			candidate({ sportType: 'cycling', distanceMeters: 20000, elapsedSeconds: 2400, movingSeconds: 2400 }),
			{ paceReference: PR }
		);
		expect(findings.some((f) => f.axis === 'for-rask')).toBe(false);
	});

	it('holder kjeft uten referanse framfor å gjette et tempo', () => {
		const findings = triageCandidate(
			candidate({ distanceMeters: 10590, elapsedSeconds: 2818, movingSeconds: 2818 })
		);
		expect(findings.some((f) => f.axis === 'for-rask')).toBe(false);
	});
});

describe('for-langsom', () => {
	it('flagger et tempo tregere enn rask gange', () => {
		const slow = (MAX_RUN_SEC_PER_KM + 120) * 5;
		const findings = triageCandidate(
			candidate({ distanceMeters: 5000, elapsedSeconds: slow, movingSeconds: slow })
		);
		expect(findings.some((f) => f.axis === 'for-langsom')).toBe(true);
	});

	it('måler på BEVEGELSESTID, så et langt stopp ikke blir en gåtur', () => {
		// 5 km på 30 min bevegelse, men klokka gikk i tre timer.
		const findings = triageCandidate(
			candidate({ distanceMeters: 5000, elapsedSeconds: 3 * 3600, movingSeconds: 30 * 60 })
		);
		expect(findings.some((f) => f.axis === 'for-langsom')).toBe(false);
		expect(findings.some((f) => f.axis === 'for-lang')).toBe(true);
	});

	it('sier i klartekst når den måtte bruke elapsed', () => {
		const slow = (MAX_RUN_SEC_PER_KM + 120) * 5;
		const findings = triageCandidate(
			candidate({ distanceMeters: 5000, elapsedSeconds: slow, movingSeconds: null })
		);
		expect(findings.find((f) => f.axis === 'for-langsom')?.reason).toContain('bevegelsestid mangler');
	});
});

describe('for-kort', () => {
	it('flagger et fragment under sportens gulv', () => {
		const findings = triageCandidate(
			candidate({ distanceMeters: 300, elapsedSeconds: 8 * 60, movingSeconds: 8 * 60 })
		);
		expect(findings.some((f) => f.axis === 'for-kort')).toBe(true);
	});

	it('bruker et LAVERE gulv for gange enn for løping', () => {
		const short = { distanceMeters: 400, elapsedSeconds: 8 * 60, movingSeconds: 8 * 60 };
		expect(
			triageCandidate(candidate({ ...short, sportType: 'walking' })).some((f) => f.axis === 'for-kort')
		).toBe(false);
		expect(
			triageCandidate(candidate({ ...short, sportType: 'running' })).some((f) => f.axis === 'for-kort')
		).toBe(true);
	});

	it('flagger en økt kortere enn tre minutter uansett distanse', () => {
		const findings = triageCandidate(
			candidate({ distanceMeters: 900, elapsedSeconds: 120, movingSeconds: 120 })
		);
		expect(findings.some((f) => f.axis === 'for-kort')).toBe(true);
	});
});

describe('for-lang', () => {
	it('flagger en tur der klokka gikk lenge etter at man var hjemme', () => {
		// El-sykkelturen: 9,07 km, 2 t 20 min elapsed, 35 min i bevegelse.
		const findings = triageCandidate(
			candidate({
				sportType: 'e_bike',
				distanceMeters: 9070,
				elapsedSeconds: 140 * 60,
				movingSeconds: 35 * 60
			})
		);
		const long = findings.find((f) => f.axis === 'for-lang');
		expect(long).toBeDefined();
		expect(long?.consequence).toContain('elapsed');
	});

	it('lar lyskryss og et kort stopp stå', () => {
		const findings = triageCandidate(
			candidate({ distanceMeters: 8000, elapsedSeconds: 50 * 60, movingSeconds: 45 * 60 })
		);
		expect(findings.some((f) => f.axis === 'for-lang')).toBe(false);
	});

	it('krever både andel og ti minutter død tid', () => {
		// 40 % stopp, men bare fem minutter av det.
		const findings = triageCandidate(
			candidate({ distanceMeters: 2000, elapsedSeconds: 750, movingSeconds: 450 })
		);
		expect(findings.some((f) => f.axis === 'for-lang')).toBe(false);
	});

	it('flagger over tolv timer uansett forholdstall', () => {
		const findings = triageCandidate(
			candidate({ distanceMeters: 40000, elapsedSeconds: 14 * 3600, movingSeconds: 13.5 * 3600 })
		);
		expect(findings.some((f) => f.axis === 'for-lang')).toBe(true);
	});
});

describe('triageReport', () => {
	it('rangerer verste først og teller per akse', () => {
		const report = triageReport(
			[
				candidate({ id: 'ok' }),
				candidate({ id: 'kort', distanceMeters: 50, elapsedSeconds: 60, movingSeconds: 60 }),
				candidate({ id: 'rask', distanceMeters: 10590, elapsedSeconds: 2818, movingSeconds: 2818 })
			],
			{ paceReference: PR }
		);

		expect(report.checked).toBe(3);
		expect(report.flagged.map((f) => f.candidate.id)).not.toContain('ok');
		expect(report.flagged[0].worst).toBeGreaterThanOrEqual(report.flagged[1].worst);
		expect(report.byAxis['for-kort']).toBeGreaterThan(0);
		expect(report.byAxis['for-rask']).toBe(1);
	});

	it('skiller «ingen funn» fra «kunne ikke se etter»', () => {
		// Ingen bevegelsestid: for-rask kan ikke dømmes i det hele tatt.
		const report = triageReport([candidate({ movingSeconds: null })], { paceReference: PR });
		expect(report.byAxis['for-rask']).toBe(0);
		expect(report.coverage['for-rask']).toBe(0);

		const withMoving = triageReport([candidate()], { paceReference: PR });
		expect(withMoving.byAxis['for-rask']).toBe(0);
		expect(withMoving.coverage['for-rask']).toBe(1);
	});

	it('bærer referansen så rapporten kan etterprøves', () => {
		expect(triageReport([], { paceReference: PR }).paceReference).toEqual(PR);
		expect(triageReport([]).paceReference).toBeNull();
	});
});
