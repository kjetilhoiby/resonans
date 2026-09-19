import { describe, it, expect } from 'vitest';
import {
	describeGoalKindForPrompt,
	groupGoal,
	inferGoalKind,
	readGoalKind,
	readLeadingIndicator,
	resolveGoalKind,
	type GoalKindShape
} from './goal-kind';

const medMetrikk: GoalKindShape = {
	metadata: { metricId: 'weight_change', goalTrack: { targetValue: -5 } }
};
const utenMetrikk: GoalKindShape = { metadata: { visionHorizon: 'vision_5year' } };

function medIndikator(over: Partial<GoalKindShape> = {}): GoalKindShape {
	return {
		metadata: { goalKind: 'tilrettelagt' },
		tasks: [
			{
				title: 'Ta initiativ til én ting',
				frequency: 'monthly',
				targetValue: 6,
				status: 'active',
				progress: [{ value: 1 }, { value: 1 }]
			} as never
		],
		...over
	};
}

describe('readGoalKind', () => {
	it('leser en satt art', () => {
		expect(readGoalKind({ goalKind: 'tilrettelagt' })).toBe('tilrettelagt');
		expect(readGoalKind({ goalKind: 'kontrollert' })).toBe('kontrollert');
	});

	it('forkaster søppel framfor å bære det videre', () => {
		expect(readGoalKind({ goalKind: 'litt av begge' })).toBeNull();
		expect(readGoalKind(null)).toBeNull();
	});
});

describe('inferGoalKind', () => {
	it('leser en metrikk som bevis på at målet er kontrollert', () => {
		expect(inferGoalKind(medMetrikk)).toBe('kontrollert');
		expect(inferGoalKind({ metadata: { metricId: 'running_10k_time' } })).toBe('kontrollert');
	});

	// Fravær av metrikk beviser ingenting: «gå ned i vekt» uten målvekt er et
	// UFERDIG kontrollert mål, ikke et tilrettelagt et. Å gjette ville satt en
	// konkret verdi der sannheten er «ikke oppgitt».
	it('gjetter ALDRI tilrettelagt', () => {
		expect(inferGoalKind(utenMetrikk)).toBeNull();
		expect(inferGoalKind({ metadata: null })).toBeNull();
	});
});

describe('resolveGoalKind', () => {
	it('lar satt art vinne over utledet', () => {
		expect(
			resolveGoalKind({ metadata: { metricId: 'weight_change', goalKind: 'tilrettelagt' } })
		).toBe('tilrettelagt');
	});

	it('faller tilbake på utledning', () => {
		expect(resolveGoalKind(medMetrikk)).toBe('kontrollert');
		expect(resolveGoalKind(utenMetrikk)).toBeNull();
	});
});

describe('readLeadingIndicator', () => {
	it('leser frekvens-oppgaven og summerer registrerte runder', () => {
		expect(readLeadingIndicator(medIndikator())).toEqual({
			title: 'Ta initiativ til én ting',
			frequency: 'monthly',
			targetValue: 6,
			done: 2
		});
	});

	it('gir null uten en frekvens-oppgave', () => {
		expect(
			readLeadingIndicator({
				tasks: [{ title: 'Engangsting', frequency: null, targetValue: null, status: 'active' } as never]
			})
		).toBeNull();
		expect(readLeadingIndicator({ tasks: [] })).toBeNull();
	});

	it('hopper over en fullført oppgave', () => {
		expect(
			readLeadingIndicator({
				tasks: [
					{ title: 'Gammel', frequency: 'weekly', targetValue: 4, status: 'completed' } as never
				]
			})
		).toBeNull();
	});
});

describe('groupGoal', () => {
	it('grupperer de fire tilstandene', () => {
		expect(groupGoal(medMetrikk)).toBe('kontrollert');
		expect(groupGoal(medIndikator())).toBe('tilrettelagt');
		expect(groupGoal({ metadata: { goalKind: 'tilrettelagt' } })).toBe('mangler-indikator');
		expect(groupGoal(utenMetrikk)).toBe('uavklart');
	});

	// Den gamle «Uten måling»-skuffen sa hva VI ikke fikk til, som om det var en
	// egenskap ved målet. De to nye båsene sier hva som mangler, og kan handles på.
	it('sender aldri et mål til en bås uten en handling', () => {
		for (const goal of [utenMetrikk, { metadata: { goalKind: 'tilrettelagt' } }]) {
			expect(['mangler-indikator', 'uavklart']).toContain(groupGoal(goal));
		}
	});
});

describe('describeGoalKindForPrompt', () => {
	it('tier om kontrollerte mål — normalen trenger ingen linje', () => {
		expect(describeGoalKindForPrompt(medMetrikk)).toBeNull();
	});

	it('sier at et tilrettelagt mål måles på handlingen, ikke på utfallet', () => {
		const linje = describeGoalKindForPrompt(medIndikator());
		expect(linje).toContain('ikke på utfallet');
		expect(linje).toContain('Ta initiativ til én ting');
		expect(linje).toContain('(2 av 6)');
		expect(linje).toContain('ikke gjør manglende utfall til noe hen har mislyktes med');
	});

	it('ber om en indikator når den mangler', () => {
		const linje = describeGoalKindForPrompt({ metadata: { goalKind: 'tilrettelagt' } });
		expect(linje).toContain('ingen ledende indikator');
		expect(linje).toContain('frekvens-oppgave');
	});

	it('sier fra at arten er uavklart uten å gjette', () => {
		const linje = describeGoalKindForPrompt(utenMetrikk);
		expect(linje).toContain('ikke avklart');
		expect(linje).toContain('ikke gjett');
	});
});
