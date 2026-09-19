import { describe, it, expect } from 'vitest';
import {
	activeForDimension,
	buildPriorityBlock,
	describeDeprioritization,
	partitionOutOfSync,
	resolveDeprioritization,
	validateDeprioritization,
	CHECKIN_INTERVAL_DAYS,
	MAX_TERM_DAYS,
	SETTLEMENT_WARNING_DAYS,
	type Deprioritization
} from './deprioritization';

const TODAY = '2026-09-19';

function periode(over: Partial<Deprioritization> = {}): Deprioritization {
	return {
		id: 'p1',
		dimensionId: 'kultur',
		startDate: '2026-08-10',
		endDate: '2026-11-02',
		reason: 'gir plass til jobbstarten',
		repair: 'to konserter i november',
		confirmedOn: null,
		settledOn: null,
		outcome: null,
		...over
	};
}

describe('resolveDeprioritization', () => {
	it('regner uke av terminen og dager igjen', () => {
		const r = resolveDeprioritization(periode(), TODAY);
		expect(r.activeToday).toBe(true);
		expect(r.weekOfTerm).toBe(6);
		expect(r.weeksInTerm).toBe(13); // 10. aug–2. nov = 85 dager
		expect(r.daysLeft).toBe(44);
		expect(r.label).toBe('Kultur');
	});

	it('faller tilbake på id-en for en ukjent dimensjon', () => {
		expect(resolveDeprioritization(periode({ dimensionId: 'sjakk' }), TODAY).label).toBe('sjakk');
	});

	// En termin som har gått ut slutter å unnskylde — men ukene den dekket, dekket den.
	it('krever oppgjør når terminen er over', () => {
		const r = resolveDeprioritization(periode({ endDate: '2026-09-10' }), TODAY);
		expect(r.activeToday).toBe(false);
		expect(r.needsSettlement).toBe(true);
		expect(r.daysLeft).toBe(-9);
	});

	it('varsler før terminslutt', () => {
		const snart = resolveDeprioritization(periode({ endDate: '2026-09-24' }), TODAY);
		expect(snart.settlementSoon).toBe(true);
		expect(snart.daysLeft).toBeLessThanOrEqual(SETTLEMENT_WARNING_DAYS);

		expect(resolveDeprioritization(periode(), TODAY).settlementSoon).toBe(false);
	});

	it('er ikke aktiv før startdatoen', () => {
		const r = resolveDeprioritization(periode({ startDate: '2026-10-01', endDate: '2026-12-01' }), TODAY);
		expect(r.activeToday).toBe(false);
		expect(r.needsSettlement).toBe(false);
	});

	it('er hverken aktiv eller ventende når oppgjøret er tatt', () => {
		const r = resolveDeprioritization(
			periode({ settledOn: '2026-09-01', outcome: 'repaired' }),
			TODAY
		);
		expect(r.settled).toBe(true);
		expect(r.activeToday).toBe(false);
		expect(r.needsSettlement).toBe(false);
	});

	// En halvårig nedprioritering ingen har sett på er ikke til å skille fra drift.
	it('ber om et livstegn på en lang termin', () => {
		const lenge = resolveDeprioritization(
			periode({ startDate: '2026-06-01', endDate: '2026-12-01' }),
			TODAY
		);
		expect(lenge.needsCheckIn).toBe(true);

		const bekreftet = resolveDeprioritization(
			periode({ startDate: '2026-06-01', endDate: '2026-12-01', confirmedOn: '2026-09-10' }),
			TODAY
		);
		expect(bekreftet.needsCheckIn).toBe(false);
	});

	it('maser ikke på en kort termin', () => {
		const r = resolveDeprioritization(periode(), TODAY);
		expect(r.needsCheckIn).toBe(false);
		expect(CHECKIN_INTERVAL_DAYS).toBeGreaterThan(40);
	});
});

describe('activeForDimension', () => {
	it('finner bare den aktive', () => {
		const rows = [
			resolveDeprioritization(periode(), TODAY),
			resolveDeprioritization(periode({ id: 'p2', dimensionId: 'venner', endDate: '2026-09-01' }), TODAY)
		];
		expect(activeForDimension(rows, 'kultur')?.id).toBe('p1');
		expect(activeForDimension(rows, 'venner')).toBeNull();
	});
});

describe('validateDeprioritization', () => {
	const gyldig = {
		dimensionId: 'kultur',
		startDate: '2026-09-19',
		endDate: '2026-12-01',
		reason: 'jobbstarten tar plassen'
	};

	it('godtar en hel termin', () => {
		const res = validateDeprioritization({ ...gyldig, repair: ' to konserter ' }, TODAY);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.value.repair).toBe('to konserter');
	});

	// Terminen ER handlingen — se filhodet.
	it('avviser en nedprioritering uten sluttdato, og sier hvorfor', () => {
		const res = validateDeprioritization({ ...gyldig, endDate: '' }, TODAY);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('drift');
	});

	it('avviser en sluttdato som alt er passert', () => {
		const res = validateDeprioritization({ ...gyldig, endDate: '2026-09-19' }, TODAY);
		expect(res.ok).toBe(false);
	});

	it('avviser en termin over taket, med lengden i meldingen', () => {
		const res = validateDeprioritization({ ...gyldig, endDate: '2028-01-01' }, TODAY);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain(String(MAX_TERM_DAYS));
	});

	it('krever en begrunnelse', () => {
		const res = validateDeprioritization({ ...gyldig, reason: '   ' }, TODAY);
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('drift');
	});

	it('avviser en ukjent dimensjon', () => {
		const res = validateDeprioritization({ ...gyldig, dimensionId: 'sjakk' }, TODAY);
		expect(res.ok).toBe(false);
	});

	it('avviser et oppgjør uten utfall', () => {
		const res = validateDeprioritization({ ...gyldig, settledOn: '2026-09-19' }, TODAY);
		expect(res.ok).toBe(false);
	});

	it('forkaster et ugyldig utfall framfor å bære det videre', () => {
		const res = validateDeprioritization({ ...gyldig, outcome: 'nesten' }, TODAY);
		expect(res.ok).toBe(true);
		if (res.ok) expect(res.value.outcome).toBeNull();
	});
});

describe('describeDeprioritization', () => {
	it('sier hvilken uke av terminen man er i', () => {
		const tekst = describeDeprioritization(resolveDeprioritization(periode(), TODAY));
		expect(tekst).toContain('Uke 6 av 13, slik du bestemte');
		expect(tekst).toContain('Grunn: gir plass til jobbstarten');
		expect(tekst).toContain('Plan: to konserter i november');
	});

	it('tilbyr alle tre utfallene når terminen er ute', () => {
		const tekst = describeDeprioritization(
			resolveDeprioritization(periode({ endDate: '2026-09-10' }), TODAY)
		);
		expect(tekst).toContain('unnskylder ikke lenger');
		expect(tekst).toContain('drift');
	});

	it('sier hva som skjedde etter et oppgjør', () => {
		expect(
			describeDeprioritization(
				resolveDeprioritization(periode({ settledOn: '2026-09-01', outcome: 'drifted' }), TODAY)
			)
		).toContain('endte som drift');
	});
});

describe('buildPriorityBlock', () => {
	it('gir tom streng uten noe aktivt eller uoppgjort', () => {
		expect(buildPriorityBlock([])).toBe('');
		expect(
			buildPriorityBlock([
				resolveDeprioritization(periode({ settledOn: '2026-09-01', outcome: 'repaired' }), TODAY)
			])
		).toBe('');
	});

	// Dette er hele grunnen til at blokka finnes: et valgt gap skal ikke
	// konfronteres, og modellen har til nå ikke hatt noe å skille dem på.
	it('sier at et valgt gap ikke skal konfronteres', () => {
		const block = buildPriorityBlock([resolveDeprioritization(periode(), TODAY)]);
		expect(block).toContain('BEVISST NEDPRIORITERT NÅ');
		expect(block).toContain('IKKE et avvik å konfrontere');
		expect(block).toContain('UTEN at noen har bestemt det');
	});

	it('skiller aktive fra utløpte', () => {
		const block = buildPriorityBlock([
			resolveDeprioritization(periode(), TODAY),
			resolveDeprioritization(periode({ id: 'p2', dimensionId: 'venner', endDate: '2026-09-10' }), TODAY)
		]);
		expect(block).toContain('BEVISST NEDPRIORITERT NÅ');
		expect(block).toContain('TERMIN UTLØPT');
		expect(block.indexOf('BEVISST')).toBeLessThan(block.indexOf('TERMIN UTLØPT'));
	});
});

describe('partitionOutOfSync', () => {
	const aktiv = resolveDeprioritization(periode(), TODAY);
	const utlopt = resolveDeprioritization(
		periode({ id: 'p2', dimensionId: 'venner', endDate: '2026-09-01' }),
		TODAY
	);

	it('skiller valgt fra drift', () => {
		const { drifting, chosen } = partitionOutOfSync(
			[{ id: 'kultur' }, { id: 'natur' }],
			[aktiv]
		);
		expect(drifting.map((d) => d.id)).toEqual(['natur']);
		expect(chosen.map((d) => d.id)).toEqual(['kultur']);
		expect(chosen[0].choice.label).toBe('Kultur');
		expect(chosen[0].choice.sentence).toContain('slik du bestemte');
	});

	// I det oppgjøret ikke er tatt, vet vi ikke lenger om det var et valg.
	it('lar en utløpt termin falle tilbake blant de driftende', () => {
		const { drifting, chosen } = partitionOutOfSync([{ id: 'venner' }], [utlopt]);
		expect(drifting.map((d) => d.id)).toEqual(['venner']);
		expect(chosen).toHaveLength(0);
	});

	it('beholder feltene på det opprinnelige elementet', () => {
		const { chosen } = partitionOutOfSync([{ id: 'kultur', gap: 5 }], [aktiv]);
		expect(chosen[0].gap).toBe(5);
	});
});

describe('validateDeprioritization — startdato', () => {
	// En rad med startdato fram i tid er hverken aktiv, uoppgjort eller avsluttet,
	// og ville derfor ikke stått i noen av flatens lister.
	it('avviser en startdato fram i tid framfor å lage en usynlig rad', () => {
		const res = validateDeprioritization(
			{
				dimensionId: 'kultur',
				startDate: '2026-10-01',
				endDate: '2026-12-01',
				reason: 'senere'
			},
			TODAY
		);
		expect(res.ok).toBe(false);
	});
});
