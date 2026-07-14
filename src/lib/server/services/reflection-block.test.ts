import { describe, it, expect } from 'vitest';
import { buildReflectionsBlock, TRANSCRIPT_REFLECTION_KINDS } from './reflection-block';

const dato = new Date('2026-07-10T12:00:00Z');

describe('buildReflectionsBlock', () => {
	it('gir tom streng uten refleksjoner', () => {
		expect(buildReflectionsBlock([])).toBe('');
	});

	it('rendrer kind, dato og innhold', () => {
		const block = buildReflectionsBlock([
			{ kind: 'day_close', content: 'God dag med trening.', createdAt: dato }
		]);
		expect(block).toContain('[day_close · 2026-07-10] God dag med trening.');
	});

	it('ekskluderer alle transkript-kinds', () => {
		const rows = TRANSCRIPT_REFLECTION_KINDS.map((kind) => ({
			kind,
			content: 'x'.repeat(5000),
			createdAt: dato
		}));
		expect(buildReflectionsBlock(rows)).toBe('');
	});

	it('trunkerer lange refleksjoner med markør', () => {
		const block = buildReflectionsBlock(
			[{ kind: 'week_review', content: 'a'.repeat(1000), createdAt: dato }],
			{ maxCharsPerReflection: 100 }
		);
		expect(block).toContain('… [forkortet]');
		expect(block).not.toContain('a'.repeat(101));
	});

	it('lar korte refleksjoner stå urørt', () => {
		const block = buildReflectionsBlock([
			{ kind: 'goal_check', content: 'Kort notat', createdAt: dato }
		]);
		expect(block).not.toContain('[forkortet]');
	});

	it('begrenser antall rader etter filtrering', () => {
		const rows = [
			{ kind: 'livsintervju_chat', content: 'transkript', createdAt: dato },
			...Array.from({ length: 10 }, (_, i) => ({
				kind: 'day_close',
				content: `Dag ${i}`,
				createdAt: dato
			}))
		];
		const block = buildReflectionsBlock(rows, { maxRows: 3 });
		expect(block).toContain('Dag 0');
		expect(block).toContain('Dag 2');
		expect(block).not.toContain('Dag 3');
		expect(block).not.toContain('transkript');
	});

	it('hopper over refleksjoner med tomt innhold', () => {
		expect(buildReflectionsBlock([{ kind: 'ad_hoc', content: '   ', createdAt: dato }])).toBe('');
	});
});
