import { describe, it, expect } from 'vitest';
import {
	SICK_CHIP_PRIORITY_PENDING,
	SICK_CHIP_PRIORITY_STANDING,
	decideSickChip,
	CHECKIN_EARLIEST_HOUR,
	CHECKIN_LATEST_HOUR,
	MAX_CHECKIN_SYMPTOMS,
	cadenceForDay,
	decideSickCheckin,
	type SickCheckinInput
} from './sick-checkin';
import type { Symptom } from './symptoms';

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

const base: SickCheckinInput = {
	periodStart: '2026-09-01',
	symptoms: [],
	lastCheckinDay: null,
	osloHour: 14,
	todayKey: '2026-09-03'
};

describe('cadenceForDay', () => {
	it('faller av med varigheten — daglig først, ukentlig til slutt', () => {
		expect(cadenceForDay(1)).toBe(1);
		expect(cadenceForDay(6)).toBe(1);
		expect(cadenceForDay(8)).toBe(2);
		expect(cadenceForDay(20)).toBe(4);
		expect(cadenceForDay(40)).toBe(7);
	});
});

describe('decideSickCheckin — når den holder kjeft', () => {
	it('når man ikke er syk', () => {
		expect(decideSickCheckin({ ...base, periodStart: null })).toBeNull();
	});

	it('utenfor tidsvinduet', () => {
		expect(decideSickCheckin({ ...base, osloHour: CHECKIN_EARLIEST_HOUR - 1 })).toBeNull();
		expect(decideSickCheckin({ ...base, osloHour: CHECKIN_LATEST_HOUR })).toBeNull();
	});

	it('på dag 1 — du registrerte deg som syk i dag, du vet hvordan det går', () => {
		expect(decideSickCheckin({ ...base, todayKey: '2026-09-01' })).toBeNull();
	});

	it('når kadensen ikke er nådd', () => {
		// Dag 3, daglig kadens, spurte i dag.
		expect(decideSickCheckin({ ...base, lastCheckinDay: '2026-09-03' })).toBeNull();
	});

	it('en lang periode maser ikke daglig', () => {
		// Dag 21 → hver 4. dag. Spurte for to dager siden.
		const input = {
			...base,
			periodStart: '2026-09-01',
			todayKey: '2026-09-21',
			lastCheckinDay: '2026-09-19'
		};
		expect(decideSickCheckin(input)).toBeNull();
		expect(decideSickCheckin({ ...input, lastCheckinDay: '2026-09-17' })).not.toBeNull();
	});
});

describe('decideSickCheckin — når den spør', () => {
	it('navngir symptomene og ber om en retning', () => {
		const d = decideSickCheckin({
			...base,
			symptoms: [
				sym({ id: 'hals', label: 'vondt i halsen', limiting: true, severity: 'mye' }),
				sym({ id: 'hoste', label: 'slimhoste' })
			]
		})!;
		expect(d.dayOfPeriod).toBe(3);
		expect(d.body).toBe('Sist meldte du vondt i halsen og slimhoste. Bedre, uendret eller verre?');
		expect(d.symptomIds).toEqual(['hals', 'hoste']);
	});

	it('det begrensende symptomet nevnes først', () => {
		const d = decideSickCheckin({
			...base,
			symptoms: [
				sym({ id: 'kne', label: 'ømt kne', severity: 'mye' }),
				sym({ id: 'hals', label: 'vondt i halsen', severity: 'litt', limiting: true })
			]
		})!;
		expect(d.symptomIds[0]).toBe('hals');
	});

	it('nevner maks MAX_CHECKIN_SYMPTOMS', () => {
		const many = Array.from({ length: 6 }, (_, i) => sym({ id: `s${i}`, label: `symptom ${i}` }));
		const d = decideSickCheckin({ ...base, symptoms: many })!;
		expect(d.symptomIds).toHaveLength(MAX_CHECKIN_SYMPTOMS);
	});

	it('uten symptomer spør den om det ene som alltid er konkret', () => {
		const d = decideSickCheckin(base)!;
		expect(d.body).toContain('frisk igjen');
		expect(d.symptomIds).toEqual([]);
	});

	it('avsluttede symptomer nevnes ikke', () => {
		const d = decideSickCheckin({
			...base,
			symptoms: [sym({ id: 'over', endDate: '2026-09-02' }), sym({ id: 'na', label: 'hoste' })]
		})!;
		expect(d.symptomIds).toEqual(['na']);
	});

	it('gir ingen medisinske råd', () => {
		const d = decideSickCheckin({ ...base, symptoms: [sym({ severity: 'mye' })] })!;
		expect(`${d.title} ${d.body}`).not.toMatch(/lege|bør|antibiotika|alvorlig|normalt varer/i);
	});
});

describe('decideSickChip', () => {
	const at = (iso: string) => new Date(iso);
	const base = {
		periodStart: '2026-09-01',
		checkinSentAt: null as Date | null,
		lastAnswerAt: null as Date | null,
		todayKey: '2026-09-03'
	};

	it('ingen chip når man ikke er syk', () => {
		expect(decideSickChip({ ...base, periodStart: null })).toBeNull();
	});

	it('står der mens perioden varer, med dag som kontekst', () => {
		const d = decideSickChip(base)!;
		expect(d.label).toBe('Syk');
		expect(d.value).toBe('dag 3');
		expect(d.pending).toBe(false);
		expect(d.priority).toBe(SICK_CHIP_PRIORITY_STANDING);
	});

	it('et sendt og ubesvart spørsmål løfter chipen', () => {
		const d = decideSickChip({ ...base, checkinSentAt: at('2026-09-03T12:00:00Z') })!;
		expect(d.label).toBe('Hvordan går det?');
		expect(d.pending).toBe(true);
		expect(d.priority).toBe(SICK_CHIP_PRIORITY_PENDING);
		expect(d.priority).toBeGreaterThan(SICK_CHIP_PRIORITY_STANDING);
	});

	it('et svar ETTER spørsmålet senker den igjen', () => {
		const d = decideSickChip({
			...base,
			checkinSentAt: at('2026-09-03T12:00:00Z'),
			lastAnswerAt: at('2026-09-03T12:05:00Z')
		})!;
		expect(d.pending).toBe(false);
		expect(d.label).toBe('Syk');
	});

	it('et svar FØR spørsmålet er ikke et svar', () => {
		// Symptomet ble registrert i går; spørsmålet kom i dag.
		const d = decideSickChip({
			...base,
			checkinSentAt: at('2026-09-03T12:00:00Z'),
			lastAnswerAt: at('2026-09-02T09:00:00Z')
		})!;
		expect(d.pending).toBe(true);
	});

	it('en ubesvart oppfølging fra i går er fortsatt ubesvart i dag', () => {
		// Derfor sammenlignes tidspunkter, ikke «sendt i dag ja/nei».
		const d = decideSickChip({ ...base, checkinSentAt: at('2026-09-02T20:00:00Z') })!;
		expect(d.pending).toBe(true);
	});
});
