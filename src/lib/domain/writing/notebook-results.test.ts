import { describe, it, expect } from 'vitest';
import { docToHit, excerptOf, mergeHits, reflectionLabel, reflectionToHit } from './notebook-results';

const T = (iso: string) => new Date(iso);

describe('excerptOf', () => {
	it('kollapser whitespace så lista ikke får hull', () => {
		expect(excerptOf('linje\n\n  to')).toBe('linje to');
	});

	it('korter ned og markerer med ellipse', () => {
		const result = excerptOf('a'.repeat(300));
		expect(result).toHaveLength(180);
		expect(result.endsWith('…')).toBe(true);
	});

	it('tåler tom og null', () => {
		expect(excerptOf(null)).toBe('');
		expect(excerptOf(undefined)).toBe('');
	});
});

describe('reflectionLabel', () => {
	it('oversetter interne kinds til norsk', () => {
		expect(reflectionLabel('notat')).toBe('Dagsnotat');
		expect(reflectionLabel('feriedagbok')).toBe('Reisedagbok');
	});

	it('faller tilbake framfor å lekke nøkkelen til flaten', () => {
		expect(reflectionLabel('noe_helt_nytt')).toBe('Refleksjon');
	});
});

describe('docToHit / reflectionToHit', () => {
	it('gir dokumentet redigerbar identitet med prosjektkobling', () => {
		const hit = docToHit(
			{
				id: 'd1',
				kind: 'scene',
				title: 'Åpningen',
				body: 'Hun så ut av vinduet.',
				projectId: 'p1',
				updatedAt: T('2026-08-07T10:00:00Z')
			},
			0.83
		);
		expect(hit.source).toBe('dokument');
		expect(hit.title).toBe('Åpningen');
		expect(hit.kindLabel).toBe('Scene');
		expect(hit.projectId).toBe('p1');
		expect(hit.similarity).toBe(0.83);
	});

	it('gir fangst en tittel av type og periode, siden logg-rader ikke har tittel', () => {
		const hit = reflectionToHit(
			{
				id: 'r1',
				kind: 'notat',
				periodKey: '2026-08-05',
				content: 'Tenkte på en åpning til boka.',
				createdAt: T('2026-08-05T19:00:00Z')
			},
			0.7
		);
		expect(hit.source).toBe('fangst');
		expect(hit.title).toBe('Dagsnotat · 2026-08-05');
		expect(hit.projectId).toBeNull();
	});

	it('utelater periode når den mangler', () => {
		const hit = reflectionToHit(
			{ id: 'r2', kind: 'day_close', periodKey: null, content: 'x', createdAt: T('2026-08-05T19:00:00Z') },
			null
		);
		expect(hit.title).toBe('Dagsavslutning');
	});
});

describe('mergeHits', () => {
	const doc = (id: string, sim: number | null, ts: string) =>
		docToHit({ id, kind: 'notat', title: id, body: 'x', projectId: null, updatedAt: T(ts) }, sim);

	it('rangerer på likhet når begge kilder har score', () => {
		const merged = mergeHits([
			doc('lav', 0.4, '2026-08-07T10:00:00Z'),
			doc('hoy', 0.9, '2026-08-01T10:00:00Z')
		]);
		expect(merged.map((h) => h.id)).toEqual(['hoy', 'lav']);
	});

	it('rangerer på tid når ingen har score', () => {
		const merged = mergeHits([
			doc('gammel', null, '2026-08-01T10:00:00Z'),
			doc('fersk', null, '2026-08-07T10:00:00Z')
		]);
		expect(merged.map((h) => h.id)).toEqual(['fersk', 'gammel']);
	});

	it('lar semantiske treff gå foran ferske uten score — et treff er et svar, ferskhet er ikke', () => {
		const merged = mergeHits([
			doc('fersk-uten-score', null, '2026-08-07T23:00:00Z'),
			doc('treff', 0.2, '2026-01-01T10:00:00Z')
		]);
		expect(merged[0].id).toBe('treff');
	});

	it('fletter dokument og fangst i samme rangering', () => {
		const merged = mergeHits([
			doc('dokument', 0.5, '2026-08-07T10:00:00Z'),
			reflectionToHit(
				{ id: 'fangst', kind: 'notat', periodKey: null, content: 'y', createdAt: T('2026-08-06T10:00:00Z') },
				0.8
			)
		]);
		expect(merged.map((h) => h.source)).toEqual(['fangst', 'dokument']);
	});

	it('respekterer limit', () => {
		const merged = mergeHits(
			[doc('a', 0.9, '2026-08-07T10:00:00Z'), doc('b', 0.8, '2026-08-07T10:00:00Z')],
			1
		);
		expect(merged).toHaveLength(1);
	});

	it('muterer ikke inn-lista', () => {
		const input = [doc('a', 0.1, '2026-08-01T10:00:00Z'), doc('b', 0.9, '2026-08-01T10:00:00Z')];
		mergeHits(input);
		expect(input.map((h) => h.id)).toEqual(['a', 'b']);
	});
});
