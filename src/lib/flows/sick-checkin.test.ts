import { describe, it, expect } from 'vitest';
import { SYMPTOM_DIRECTIONS, buildSickCheckinFlow, offersRecovery } from './sick-checkin';

/** `Flow.steps` er valgfri i typen, men en flyt uten steg er meningsløs. */
const stepsOf = (over: Partial<Parameters<typeof buildSickCheckinFlow>[0]> = {}) =>
	buildSickCheckinFlow(ctx(over)).steps ?? [];

const ctx = (over: Partial<Parameters<typeof buildSickCheckinFlow>[0]> = {}) => ({
	dayOfPeriod: 3,
	todayKey: '2026-09-03',
	symptoms: [
		{ id: 'hals', label: 'vondt i halsen', severity: 'mye' as const },
		{ id: 'hoste', label: 'slimhoste', severity: 'merkbart' as const }
	],
	previousLevel: { day: '2026-09-02', level: 2 },
	signals: ['Sovepuls 8 slag over snittet', 'Hudtemperatur 0,6 °C over ditt eget snitt'],
	...over
});

describe('buildSickCheckinFlow', () => {
	it('tittelen sier hvor i forløpet man er', () => {
		expect(stepsOf()[0]!.title).toBe('Hvordan er det i dag? (dag 3)');
	});

	it('tre steg med symptomer, to uten — «kort innsjekk» tåler ikke et tomt steg', () => {
		expect(stepsOf()).toHaveLength(3);
		expect(stepsOf({ symptoms: [] })).toHaveLength(2);
	});

	it('slideren er første steg og har INGEN tall rundt seg', () => {
		// Sensortall før slideren ville ankret selvrapporten — det eneste
		// signalet ingen sensor kan hente.
		const step = stepsOf()[0]!;
		const shown = `${step.title} ${step.prompt}`;
		expect(shown).not.toMatch(/sovepuls|hudtemperatur|termometer/i);
		expect(step.fields?.[0].type).toBe('slider');
		expect(step.autoAdvance).toBe(true);
	});

	it('tallene kommer i steg TO, etter svaret', () => {
		const step = stepsOf()[1]!;
		const prompt = step.buildPrompts?.({ level: 3 })?.prompt ?? '';
		expect(prompt).toContain('Sovepuls 8 slag over snittet');
		expect(prompt).toContain('Hudtemperatur');
	});

	it('retningen regnes av nivået brukeren nettopp ga, og står først', () => {
		const step = stepsOf()[1]!;
		const prompt = step.buildPrompts?.({ level: 3 })?.prompt ?? '';
		expect(prompt.startsWith('Ett hakk opp fra i går')).toBe(true);
	});

	it('uten forrige måling faller retningen bort, men tallene står', () => {
		const step = stepsOf({ previousLevel: null })[1]!;
		const prompt = step.buildPrompts?.({ level: 3 })?.prompt ?? '';
		expect(prompt).not.toContain('hakk');
		expect(prompt).toContain('Sovepuls');
	});

	it('uten symptomer bærer det gjenstående steget tallene', () => {
		const prompt = stepsOf({ symptoms: [] })[1]!.buildPrompts?.({ level: 4 })?.prompt ?? '';
		expect(prompt).toContain('Sovepuls');
	});

	it('symptomsteget tilbyr bedre/uendret/verre/over', () => {
		const step = stepsOf()[1]!;
		expect(step.type).toBe('decision-list');
		expect(step.decisionOptions?.map((o) => o.value)).toEqual([
			'bedre',
			'uendret',
			'verre',
			'over'
		]);
		expect(step.defaultDecision).toBe('uendret');
	});

	it('praten er en secondaryAction, ikke et fjerde steg', () => {
		const steps = stepsOf();
		expect(steps[steps.length - 1]!.secondaryAction?.id).toBe('sick-chat');
		expect(steps.every((s) => s.type !== 'chat')).toBe(true);
	});

	it('ingen medisinske råd i noe steg', () => {
		const text = stepsOf()
			.map((s) => `${s.title} ${s.prompt} ${s.buildPrompts?.({ level: 1 })?.prompt ?? ''}`)
			.join(' ');
		expect(text).not.toMatch(/\blege\b|\bbør\b|diagnos|normalt varer|antibiotika/i);
	});
});

describe('offersRecovery', () => {
	it('bare på toppen av skalaen', () => {
		expect(offersRecovery(5)).toBe(true);
		expect(offersRecovery(4)).toBe(false);
		expect(offersRecovery(undefined)).toBe(false);
	});
});

describe('SYMPTOM_DIRECTIONS', () => {
	it('«over» finnes, så et symptom kan avsluttes fra innsjekken', () => {
		expect(SYMPTOM_DIRECTIONS.some((d) => d.value === 'over')).toBe(true);
	});
});
