import { describe, it, expect } from 'vitest';
import { childForGrade, describeChildForPrompt, parseGradeHint, schoolGradeForBirthDate } from './school-grade';

describe('schoolGradeForBirthDate', () => {
	it('født 2019 går i 2. trinn høsten 2026', () => {
		expect(schoolGradeForBirthDate('2019-03-14', '2026-11-06')).toBe(2);
	});

	it('trinnet skifter 1. august, ikke ved nyttår', () => {
		expect(schoolGradeForBirthDate('2019-03-14', '2026-07-31')).toBe(1);
		expect(schoolGradeForBirthDate('2019-03-14', '2026-08-01')).toBe(2);
		expect(schoolGradeForBirthDate('2019-12-31', '2027-02-01')).toBe(2);
	});

	it('gir null for barnehagebarn, ungdom etter 10. trinn og manglende dato', () => {
		expect(schoolGradeForBirthDate('2022-05-01', '2026-11-06')).toBeNull();
		expect(schoolGradeForBirthDate('2008-05-01', '2026-11-06')).toBeNull();
		expect(schoolGradeForBirthDate(null, '2026-11-06')).toBeNull();
	});
});

describe('parseGradeHint', () => {
	it('leser klassenavnet i en ukeplan', () => {
		expect(parseGradeHint('Ukeplan 46 2B\nPeriode: Gi det videre')).toBe(2);
		expect(parseGradeHint('Klassetelefon 10A')).toBe(10);
	});

	it('leser «N. trinn» og «trinn N»', () => {
		expect(parseGradeHint('Dato for vaksinering for 2. trinn er 20.11.26.')).toBe(2);
		expect(parseGradeHint('Info til foreldre på trinn 4')).toBe(4);
	});

	it('gir null når flere trinn nevnes', () => {
		expect(parseGradeHint('Felles for 2B og 4A')).toBeNull();
	});

	it('tar ikke klokkeslett, datoer eller ukenummer for et trinn', () => {
		expect(parseGradeHint('Mandag 09.11 kl. 8.30')).toBeNull();
		expect(parseGradeHint('Uke 46')).toBeNull();
	});
});

describe('childForGrade', () => {
	const children = [
		{ id: 'a', name: 'Eldst', birthDate: '2016-06-01' },
		{ id: 'b', name: 'Yngst', birthDate: '2019-03-14' },
		{ id: 'c', name: 'Uten dato', birthDate: null }
	];

	it('finner barnet som går på trinnet', () => {
		expect(childForGrade(children, 2, '2026-11-06')?.id).toBe('b');
		expect(childForGrade(children, 5, '2026-11-06')?.id).toBe('a');
	});

	it('gir null når ingen eller flere går på trinnet', () => {
		expect(childForGrade(children, 3, '2026-11-06')).toBeNull();
		const twins = [...children, { id: 'd', name: 'Tvilling', birthDate: '2019-03-14' }];
		expect(childForGrade(twins, 2, '2026-11-06')).toBeNull();
	});
});

describe('describeChildForPrompt', () => {
	it('legger til trinnet når det er kjent', () => {
		expect(describeChildForPrompt({ id: 'b', name: 'Yngst', birthDate: '2019-03-14' }, '2026-11-06')).toBe('Yngst (2. trinn)');
		expect(describeChildForPrompt({ id: 'c', name: 'Uten dato', birthDate: null }, '2026-11-06')).toBe('Uten dato');
	});
});
