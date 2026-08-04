import { describe, it, expect } from 'vitest';
import { frameDay } from './day-framing';

describe('frameDay', () => {
	it('viser ikke «underskudd» kl. 07 om morgenen', () => {
		// Skjermbildet som avdekket feilen: 62 kcal spist, 2 458 forbrent, og
		// «Underskudd 2 396 kcal» i grønt. Det ser ut som en prestasjon.
		const framing = frameDay({
			intakeKcal: 62,
			expenditureKcal: 2458,
			dayComplete: false
		});
		expect(framing.mode).toBe('remaining');
		expect(framing.label).toBe('Igjen i dag');
		expect(framing.kcal).toBe(2396);
		expect(framing.direction).toBeNull();
	});

	it('måler mot dagsmålet når det er satt', () => {
		// Målet er det man styrer etter; forbruket tilsvarer å holde vekta.
		const framing = frameDay({
			intakeKcal: 1439,
			expenditureKcal: 3168,
			targetKcal: 2600,
			dayComplete: false
		});
		expect(framing.basis).toBe('target');
		expect(framing.kcal).toBe(1161);
	});

	it('faller tilbake på forbruket uten mål', () => {
		const framing = frameDay({
			intakeKcal: 1439,
			expenditureKcal: 3168,
			dayComplete: false
		});
		expect(framing.basis).toBe('expenditure');
		expect(framing.kcal).toBe(1729);
	});

	it('sier «over for i dag» når budsjettet er brukt opp', () => {
		const framing = frameDay({
			intakeKcal: 2900,
			expenditureKcal: 2600,
			targetKcal: 2600,
			dayComplete: false
		});
		expect(framing.label).toBe('Over for i dag');
		expect(framing.kcal).toBe(300);
		expect(framing.overBasis).toBe(true);
	});

	it('gjør opp dagen først når den er omme', () => {
		const framing = frameDay({
			intakeKcal: 2400,
			expenditureKcal: 2800,
			targetKcal: 2600,
			dayComplete: true
		});
		expect(framing.mode).toBe('settled');
		expect(framing.label).toBe('Underskudd');
		expect(framing.kcal).toBe(400);
		expect(framing.direction).toBe('deficit');
		// Målet er irrelevant for en avsluttet dag — da er det spist mot forbrent.
		expect(framing.basis).toBeNull();
	});

	it('kjenner overskudd og balanse på en avsluttet dag', () => {
		expect(
			frameDay({ intakeKcal: 3000, expenditureKcal: 2600, dayComplete: true }).direction
		).toBe('surplus');
		expect(
			frameDay({ intakeKcal: 2600, expenditureKcal: 2600, dayComplete: true }).direction
		).toBe('even');
		expect(
			frameDay({ intakeKcal: 2600, expenditureKcal: 2600, dayComplete: true }).label
		).toBe('Balanse');
	});

	it('ignorerer et mål på null eller negativt', () => {
		const framing = frameDay({
			intakeKcal: 500,
			expenditureKcal: 2500,
			targetKcal: 0,
			dayComplete: false
		});
		expect(framing.basis).toBe('expenditure');
		expect(framing.kcal).toBe(2000);
	});
});
