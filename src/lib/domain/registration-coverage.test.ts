import { describe, it, expect } from 'vitest';
import {
	buildCoverage,
	describeFocus,
	findRegistrationFocus,
	registrationDomainOf,
	unlockFor,
	type RegistrationDomain
} from './registration-coverage';
import { MIN_DAYS_FOR_VERDICT, MIN_LOGGED_COVERAGE } from './nutrition/weight-reality-check';
import { MIN_WEEK_WEIGH_INS } from './digest-nugget-rules';

const TODAY = '2026-10-08';

function days(...offsets: number[]): Set<string> {
	return new Set(
		offsets.map((o) => {
			const d = new Date(`${TODAY}T12:00:00Z`);
			d.setUTCDate(d.getUTCDate() - o);
			return d.toISOString().slice(0, 10);
		})
	);
}

function input(partial: Partial<Record<RegistrationDomain, Set<string>>>): Record<RegistrationDomain, Set<string>> {
	return { mat: new Set(), vekt: new Set(), oppgaver: new Set(), egenfrekvens: new Set(), lesing: new Set(), ...partial };
}

describe('buildCoverage', () => {
	it('teller sju og fjorten dager, med i dag sist', () => {
		const [mat] = buildCoverage(input({ mat: days(0, 1, 2, 10, 13, 20) }), TODAY);
		expect(mat.last7).toBe(3);
		expect(mat.last14).toBe(5);
		expect(mat.today).toBe(true);
		expect(mat.week).toEqual([false, false, false, false, true, true, true]);
	});
});

describe('registrationDomainOf', () => {
	it('kjenner igjen registrering som fokus', () => {
		expect(registrationDomainOf('Måltidslogg (7 dager)')).toBe('mat');
		expect(registrationDomainOf('Veie meg hver morgen')).toBe('vekt');
		expect(registrationDomainOf('Egenfrekvens hver kveld')).toBe('egenfrekvens');
		expect(registrationDomainOf('Lese 20 sider i boka')).toBe('lesing');
	});

	it('tar ikke et vektmål eller lesing med barna for et registreringsfokus', () => {
		expect(registrationDomainOf('Redusere vekt til 85 kg')).toBeNull();
		expect(registrationDomainOf('Lese eller leke med barna i stedet for skjerm (4 ganger)')).toBeNull();
		expect(registrationDomainOf('Løpe 600 km')).toBeNull();
	});
});

describe('findRegistrationFocus', () => {
	it('gir ett fokus per område, og et mål går foran ukelista', () => {
		const focus = findRegistrationFocus([
			{ text: 'Måltidslogg (7 dager)', source: 'ukeliste' },
			{ text: 'Logge måltider hver dag i oktober', source: 'mål' },
			{ text: 'Redusere vekt til 85 kg', source: 'mål' }
		]);
		expect(focus).toEqual([{ domain: 'mat', text: 'Logge måltider hver dag i oktober', source: 'mål' }]);
	});
});

describe('describeFocus', () => {
	const needed = Math.ceil(MIN_LOGGED_COVERAGE * MIN_DAYS_FOR_VERDICT);

	it('minner om fokuset med brukerens ord, dekningen og det som låses opp', () => {
		const [mat] = buildCoverage(input({ mat: days(1, 2, 3) }), TODAY);
		expect(describeFocus({ domain: 'mat', text: 'Måltidslogg (7 dager)', source: 'ukeliste' }, mat)).toBe(
			`Måltidslogg (7 dager) står på ukelista. Mat er registrert 3 av de siste sju dagene. Med ${needed} av ${MIN_DAYS_FOR_VERDICT} dager kan jeg si om energiregnskapet stemmer med vekta; nå er det 3.`
		);
	});

	it('sier ingenting om dagen i dag', () => {
		const [mat] = buildCoverage(input({ mat: days(1) }), TODAY);
		expect(describeFocus({ domain: 'mat', text: 'Måltidslogg', source: 'ukeliste' }, mat)).not.toMatch(/i dag/);
	});
});

describe('unlockFor', () => {
	it('tier når terskelen er nådd, og for områder uten terskel', () => {
		const all = days(...Array.from({ length: 14 }, (_, i) => i));
		const coverage = buildCoverage(input({ mat: all, vekt: all, lesing: days(0) }), TODAY);
		expect(unlockFor('mat', coverage[0])).toBeNull();
		expect(unlockFor('vekt', coverage[1])).toBeNull();
		expect(unlockFor('lesing', coverage[4])).toBeNull();
		expect(unlockFor('vekt', buildCoverage(input({ vekt: days(0) }), TODAY)[1])).toContain(`${MIN_WEEK_WEIGH_INS} veiinger`);
	});
});
