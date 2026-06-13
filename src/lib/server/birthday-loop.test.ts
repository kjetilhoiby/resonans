import { describe, expect, it } from 'vitest';
import { buildBirthdayLoop, type LoopGoalInput } from './birthday-loop';

const goal = (title: string, metadata: LoopGoalInput['metadata'], status = 'active'): LoopGoalInput => ({
	title,
	status,
	metadata
});

describe('buildBirthdayLoop', () => {
	it('regner løpemål som oppnådd når kavalkade-km når målet', () => {
		const loop = buildBirthdayLoop({
			goals: [goal('Løpe til neste bursdag', { target: { value: 600, unit: 'km' }, tracking: { metric: 'running_distance' } })],
			prophecyContent: null,
			runningKm: 612
		});
		expect(loop.promises[0]).toMatchObject({ targetValue: 600, actualValue: 612, achieved: true });
		expect(loop.hasData).toBe(true);
	});

	it('markerer målbart mål som ikke nådd når faktisk < mål', () => {
		const loop = buildBirthdayLoop({
			goals: [goal('Lese', { target: { value: 12, unit: 'bøker' }, currentValue: 7 })],
			prophecyContent: null,
			runningKm: null
		});
		expect(loop.promises[0]).toMatchObject({ targetValue: 12, actualValue: 7, achieved: false });
	});

	it('gir achieved=null for målbart mål uten faktiske tall', () => {
		const loop = buildBirthdayLoop({
			goals: [goal('Ned i vekt', { target: { value: 3, unit: 'kg' }, tracking: { metric: 'weight_kg' } })],
			prophecyContent: null,
			runningKm: null
		});
		expect(loop.promises[0].achieved).toBeNull();
	});

	it('umålbart mål: completed = oppnådd, ellers uvisst', () => {
		const done = buildBirthdayLoop({ goals: [goal('Mindre skjerm', null, 'completed')], prophecyContent: null, runningKm: null });
		expect(done.promises[0]).toMatchObject({ targetValue: null, achieved: true });
		const open = buildBirthdayLoop({ goals: [goal('Mindre skjerm', null, 'active')], prophecyContent: null, runningKm: null });
		expect(open.promises[0].achieved).toBeNull();
	});

	it('trekker ut spådommens første avsnitt', () => {
		const loop = buildBirthdayLoop({
			goals: [],
			prophecyContent: 'Du kommer til å runde 600 km.\n\nOg mer til.',
			runningKm: null
		});
		expect(loop.prophecyExcerpt).toBe('Du kommer til å runde 600 km.');
		expect(loop.hasData).toBe(true);
	});

	it('hasData=false uten mål og uten spådom', () => {
		expect(buildBirthdayLoop({ goals: [], prophecyContent: null, runningKm: null }).hasData).toBe(false);
	});
});
