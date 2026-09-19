import { describe, expect, it } from 'vitest';
import {
	MAX_PRIORITIES,
	RANKING_STALE_DAYS,
	buildRankingBlock,
	describeRanking,
	isRankingStale,
	rankingAgeDays,
	normalizeStoredPriorities,
	resolvePriorityAnchor,
	validatePriorities,
	type Ranking
} from './ranking';

function ranking(labels: string[], setOn = '2026-02-12'): Ranking {
	const parsed = validatePriorities(labels.map((label) => ({ label })));
	if (!parsed.ok) throw new Error(parsed.error);
	return { priorities: parsed.value, setOn };
}

describe('resolvePriorityAnchor', () => {
	it('treffer en dimensjon på id, full etikett og kort etikett', () => {
		expect(resolvePriorityAnchor('trening')).toEqual({
			kind: 'dimension',
			id: 'trening',
			label: 'Trening'
		});
		expect(resolvePriorityAnchor('Søvn & hvile')?.id).toBe('sovn');
		expect(resolvePriorityAnchor('  Søvn ')?.id).toBe('sovn');
	});

	it('treffer et OMRÅDE — «helse først» peker ikke på noen dimensjon', () => {
		expect(resolvePriorityAnchor('Helse')).toEqual({
			kind: 'area',
			id: 'helse',
			label: 'Helse'
		});
	});

	it('gjetter aldri på delstreng', () => {
		// «Mer tid til barna» inneholder «barn», men forankringen skal ikke
		// påstå at hjulets Barn-akse måler nettopp dette.
		expect(resolvePriorityAnchor('Mer tid til barna')).toBeNull();
		expect(resolvePriorityAnchor('')).toBeNull();
	});
});

describe('validatePriorities', () => {
	it('utleder forankringen selv og lar uforankrede stå', () => {
		const res = validatePriorities([
			{ label: 'Helse', why: 'alt annet henger på den' },
			{ label: 'Ekstra oppmerksomhet til hvert barn fra ti år' }
		]);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value[0]).toEqual({
			label: 'Helse',
			anchorKind: 'area',
			anchorId: 'helse',
			why: 'alt annet henger på den'
		});
		expect(res.value[1].anchorKind).toBeNull();
		expect(res.value[1].why).toBeNull();
	});

	it('avviser en liste som er for lang til å være en rekkefølge', () => {
		const long = Array.from({ length: MAX_PRIORITIES + 1 }, (_, i) => ({ label: `Ting ${i}` }));
		const res = validatePriorities(long);
		expect(res.ok).toBe(false);
	});

	it('avviser duplikater — en rekkefølge har én plass per ting', () => {
		const res = validatePriorities([{ label: 'Helse' }, { label: 'helse' }]);
		expect(res.ok).toBe(false);
		if (res.ok) return;
		expect(res.error).toContain('to ganger');
	});

	it('avviser tom etikett og for lang tekst', () => {
		expect(validatePriorities([{ label: '   ' }]).ok).toBe(false);
		expect(validatePriorities([{ label: 'A'.repeat(200) }]).ok).toBe(false);
		expect(validatePriorities([{ label: 'Helse', why: 'x'.repeat(400) }]).ok).toBe(false);
	});

	it('godtar en tom liste — å stryke rekkefølgen er lov', () => {
		const res = validatePriorities([]);
		expect(res.ok).toBe(true);
	});

	it('avviser noe som ikke er en liste', () => {
		expect(validatePriorities('helse').ok).toBe(false);
	});
});

describe('normalizeStoredPriorities', () => {
	it('er TOLERANT der validatePriorities er streng — en lagret rekkefølge forsvinner ikke', () => {
		const lagret = Array.from({ length: MAX_PRIORITIES + 2 }, (_, i) => ({ label: `Ting ${i}` }));
		expect(validatePriorities(lagret).ok).toBe(false);
		expect(normalizeStoredPriorities(lagret)).toHaveLength(MAX_PRIORITIES + 2);
	});

	it('regner forankringen på nytt og hopper over rader uten tekst', () => {
		const rows = normalizeStoredPriorities([
			{ label: 'Trening', why: 'kroppen' },
			{ label: '   ' },
			{ why: 'ingen etikett' }
		]);
		expect(rows).toEqual([
			{ label: 'Trening', anchorKind: 'dimension', anchorId: 'trening', why: 'kroppen' }
		]);
	});

	it('gir tom liste for noe som ikke er en liste', () => {
		expect(normalizeStoredPriorities(null)).toEqual([]);
	});
});

describe('alder', () => {
	it('regner dager og flagger en rekkefølge som er over et år gammel', () => {
		const r = ranking(['Helse'], '2025-01-01');
		expect(rankingAgeDays(r, '2025-01-11')).toBe(10);
		expect(isRankingStale(r, '2025-06-01')).toBe(false);
		expect(isRankingStale(r, '2026-06-01')).toBe(true);
	});

	it('gir null alder på en ulesbar dato framfor å gjette', () => {
		expect(rankingAgeDays({ priorities: [], setOn: 'i fjor' }, '2026-01-01')).toBeNull();
		expect(isRankingStale({ priorities: [], setOn: 'i fjor' }, '2026-01-01')).toBe(false);
	});

	it('taket er ett år', () => {
		expect(RANKING_STALE_DAYS).toBe(365);
	});
});

describe('describeRanking', () => {
	it('nummererer etter posisjon, ikke et lagret tall', () => {
		const r = ranking(['Helse', 'Bidrag hjemme', 'Venner']);
		expect(describeRanking(r)).toBe('1. Helse\n2. Bidrag hjemme\n3. Venner');
	});
});

describe('buildRankingBlock', () => {
	it('er tom uten rekkefølge', () => {
		expect(buildRankingBlock(null, '2026-09-19')).toBe('');
		expect(buildRankingBlock({ priorities: [], setOn: '2026-01-01' }, '2026-09-19')).toBe('');
	});

	it('sier eksplisitt at det som mangler ikke er valgt bort', () => {
		const block = buildRankingBlock(ranking(['Helse', 'Bidrag hjemme']), '2026-09-19');
		expect(block).toContain('REKKEFØLGEN');
		expect(block).toContain('12. februar 2026');
		expect(block).toContain('1. Helse');
		expect(block).toContain('ikke valgt bort');
	});

	it('utelater datoen framfor å skrive «NaN» når den ikke er lesbar', () => {
		const block = buildRankingBlock(
			{ priorities: ranking(['Helse']).priorities, setOn: '' },
			'2026-09-19'
		);
		expect(block).toContain('REKKEFØLGEN (brukerens egen prioritering):');
		expect(block).not.toContain('NaN');
	});

	it('sier fra når rekkefølgen er gammel — uten å slutte å vise den', () => {
		const block = buildRankingBlock(ranking(['Helse'], '2024-01-05'), '2026-09-19');
		expect(block).toContain('1. Helse');
		expect(block).toContain('over et år gammel');
	});
});
