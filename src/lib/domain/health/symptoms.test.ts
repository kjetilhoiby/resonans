import { describe, it, expect } from 'vitest';
import {
	MAX_SYMPTOM_LABEL,
	describeSymptom,
	rankOngoingSymptoms,
	resolveSymptom,
	summarizeSymptoms,
	symptomsOnDay,
	validateSymptom,
	type Symptom
} from './symptoms';

const sym = (over: Partial<Symptom> = {}): Symptom => ({
	id: 's1',
	label: 'vondt i halsen',
	kind: 'luftveier',
	severity: 'merkbart',
	startDate: '2026-09-01',
	endDate: null,
	limiting: false,
	note: null,
	...over
});

describe('resolveSymptom', () => {
	it('et symptom i dag varer én dag, ikke null', () => {
		expect(resolveSymptom(sym({ startDate: '2026-09-02' }), '2026-09-02').days).toBe(1);
	});

	it('teller aldri fram i tid', () => {
		const r = resolveSymptom(sym({ endDate: '2026-09-20' }), '2026-09-03');
		expect(r.days).toBe(3);
		expect(r.ongoing).toBe(true);
	});

	it('avsluttet symptom er ikke pågående', () => {
		const r = resolveSymptom(sym({ endDate: '2026-09-02' }), '2026-09-05');
		expect(r.ongoing).toBe(false);
		expect(r.days).toBe(2);
	});
});

describe('rankOngoingSymptoms', () => {
	it('det begrensende først, uansett alvorlighet', () => {
		// Kneet er «mye» men ikke grunnen; halsen er «litt» og er det.
		const ranked = rankOngoingSymptoms(
			[
				sym({ id: 'kne', label: 'ømt kne', kind: 'muskel_skjelett', severity: 'mye' }),
				sym({ id: 'hals', severity: 'litt', limiting: true })
			],
			'2026-09-03'
		);
		expect(ranked.map((s) => s.id)).toEqual(['hals', 'kne']);
	});

	it('deretter etter alvorlighet, deretter varighet', () => {
		const ranked = rankOngoingSymptoms(
			[
				sym({ id: 'a', severity: 'litt' }),
				sym({ id: 'b', severity: 'mye' }),
				sym({ id: 'c', severity: 'merkbart' })
			],
			'2026-09-03'
		);
		expect(ranked.map((s) => s.id)).toEqual(['b', 'c', 'a']);
	});

	it('avsluttede symptomer er ute', () => {
		const ranked = rankOngoingSymptoms(
			[sym({ id: 'over', endDate: '2026-09-01' }), sym({ id: 'na' })],
			'2026-09-05'
		);
		expect(ranked.map((s) => s.id)).toEqual(['na']);
	});
});

describe('symptomsOnDay', () => {
	it('finner symptomene som var der den dagen', () => {
		const list = [
			sym({ id: 'hals', startDate: '2026-09-01', endDate: '2026-09-04' }),
			sym({ id: 'kne', startDate: '2026-09-03', endDate: null })
		];
		expect(symptomsOnDay(list, '2026-09-02').map((s) => s.id)).toEqual(['hals']);
		expect(symptomsOnDay(list, '2026-09-03').map((s) => s.id)).toEqual(['hals', 'kne']);
		expect(symptomsOnDay(list, '2026-09-06').map((s) => s.id)).toEqual(['kne']);
	});
});

describe('validateSymptom', () => {
	it('krever en beskrivelse', () => {
		expect(validateSymptom({ label: '   ' }, '2026-09-02').ok).toBe(false);
	});

	it('avviser en for lang beskrivelse', () => {
		const r = validateSymptom({ label: 'a'.repeat(MAX_SYMPTOM_LABEL + 1) }, '2026-09-02');
		expect(r.ok).toBe(false);
	});

	it('defaulter til i dag og «merkbart»/«annet»', () => {
		const r = validateSymptom({ label: 'sliten' }, '2026-09-02');
		expect(r.ok && r.value).toMatchObject({
			startDate: '2026-09-02',
			severity: 'merkbart',
			kind: 'annet',
			limiting: false
		});
	});

	it('ukjent kind og severity gjettes trygt framfor å avvises', () => {
		// En gjettet default her kan ikke gjøre noe galt — i motsetning til
		// startWorkout.type, der en gjetning ble løpecoaching på en elsykkel.
		const r = validateSymptom({ label: 'x', kind: 'tull', severity: 'tull' }, '2026-09-02');
		expect(r.ok && r.value.kind).toBe('annet');
		expect(r.ok && r.value.severity).toBe('merkbart');
	});

	it('avviser startdato fram i tid', () => {
		expect(validateSymptom({ label: 'x', startDate: '2026-09-10' }, '2026-09-02').ok).toBe(false);
	});

	it('avviser sluttdato før start', () => {
		const r = validateSymptom(
			{ label: 'x', startDate: '2026-09-05', endDate: '2026-09-01' },
			'2026-09-10'
		);
		expect(r.ok).toBe(false);
	});
});

describe('summarizeSymptoms', () => {
	it('sier hva som begrenser, og hva som ellers er der', () => {
		// Situasjonen som utløste modellen: tre samtidige, én av dem grunnen.
		const text = summarizeSymptoms(
			[
				sym({ id: 'hals', label: 'vondt i halsen', severity: 'mye', limiting: true }),
				sym({ id: 'hoste', label: 'slimhoste', severity: 'merkbart' }),
				sym({ id: 'kne', label: 'ømt kne', kind: 'muskel_skjelett', severity: 'litt' })
			],
			'2026-09-03'
		);
		expect(text).toBe(
			'vondt i halsen (mye) er det som begrenser; også: slimhoste (merkbart), ømt kne (litt)'
		);
	});

	it('uten et begrensende symptom sier den bare hva som pågår', () => {
		expect(summarizeSymptoms([sym({ label: 'ømt kne' })], '2026-09-03')).toBe(
			'pågående: ømt kne (merkbart)'
		);
	});

	it('null når ingenting pågår', () => {
		expect(summarizeSymptoms([sym({ endDate: '2026-08-30' })], '2026-09-03')).toBeNull();
		expect(summarizeSymptoms([], '2026-09-03')).toBeNull();
	});

	it('tolker ingenting — ingen råd, ingen årsak', () => {
		const text = summarizeSymptoms(
			[sym({ label: 'vondt i halsen', severity: 'mye', limiting: true })],
			'2026-09-03'
		)!;
		expect(text).not.toMatch(/infeksjon|virus|bør|anbefal|hvil/i);
	});
});

describe('describeSymptom', () => {
	it('navngir det begrensende', () => {
		expect(
			describeSymptom(resolveSymptom(sym({ severity: 'mye', limiting: true }), '2026-09-03'))
		).toBe('vondt i halsen (mye, 3 dager) — grunnen til at du står over');
	});

	it('avsluttet symptom sier når det gikk over', () => {
		expect(describeSymptom(resolveSymptom(sym({ endDate: '2026-09-04' }), '2026-09-10'))).toBe(
			'vondt i halsen (merkbart, 4 dager) — over 4. sep'
		);
	});
});
