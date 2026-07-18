import { describe, it, expect } from 'vitest';
import {
	hodedumpFlokeOptions,
	hodedumpPlacements,
	hodedumpReflectionPrompts,
	hodedumpSummary
} from './hodedump';

const flowData = {
	triage_items: [
		{ id: 'p0', text: 'Rydde garasjen' },
		{ id: 'p1', text: 'Forsikringssaken' },
		{ id: 'p2', text: 'Ringe tannlegen' },
		{ id: 'p3', text: 'Gammel bekymring om jobb' },
		{ id: 'p4', text: 'Kjøpe bursdagsgave' }
	],
	decisions: { p0: 'floke', p1: 'floke', p2: 'idag', p3: 'slipp', p4: 'parker' }
};

describe('hodedumpPlacements', () => {
	it('sorterer punkter etter triage-beslutning', () => {
		const p = hodedumpPlacements(flowData);
		expect(p.floker).toEqual(['Rydde garasjen', 'Forsikringssaken']);
		expect(p.idag).toEqual(['Ringe tannlegen']);
		expect(p.sluppet).toEqual(['Gammel bekymring om jobb']);
		expect(p.parkert).toEqual(['Kjøpe bursdagsgave']);
	});

	it('punkter uten beslutning parkeres (trygg default)', () => {
		const p = hodedumpPlacements({
			triage_items: [{ id: 'p0', text: 'Noe' }],
			decisions: {}
		});
		expect(p.parkert).toEqual(['Noe']);
	});

	it('tom flowData → tomme plasseringer', () => {
		const p = hodedumpPlacements({});
		expect(p).toEqual({ floker: [], idag: [], parkert: [], sluppet: [] });
	});
});

describe('hodedumpSummary', () => {
	it('oppsummerer alle plasseringer med valgt floke', () => {
		const p = hodedumpPlacements(flowData);
		const s = hodedumpSummary(p, 'Rydde garasjen', 3);
		expect(s).toContain('5 punkter ut av hodet');
		expect(s).toContain('1 floke under nedbryting («Rydde garasjen», 3 første steg)');
		expect(s).toContain('1 floke lagt som prosjekt');
		expect(s).toContain('1 til i dag');
		expect(s).toContain('1 parkert i innboksen');
		expect(s).toContain('1 sluppet');
	});

	it('uten valgt floke telles alle floker som prosjekter', () => {
		const p = hodedumpPlacements(flowData);
		const s = hodedumpSummary(p, null, 0);
		expect(s).toContain('2 floker lagt som prosjekt');
		expect(s).not.toContain('under nedbryting');
	});
});

describe('hodedumpFlokeOptions', () => {
	it('bygger select-options fra floke-markerte punkter', () => {
		expect(hodedumpFlokeOptions(flowData)).toEqual([
			{ value: 'Rydde garasjen', label: 'Rydde garasjen' },
			{ value: 'Forsikringssaken', label: 'Forsikringssaken' }
		]);
	});
});

describe('hodedumpReflectionPrompts', () => {
	it('prompt inneholder oppsummeringen, systemprompt landings-instruksen', () => {
		const { prompt, systemPrompt } = hodedumpReflectionPrompts({
			...flowData,
			valgtFloke: 'Rydde garasjen',
			selectedTasks: ['Kjøp sekker', 'Sett av lørdag formiddag']
		});
		expect(prompt).toContain('Jeg har tømt hodet');
		expect(prompt).toContain('2 første steg');
		expect(systemPrompt).toContain('Hvordan kjennes hodet nå');
		expect(systemPrompt).toContain('landing');
	});
});
