import { describe, it, expect } from 'vitest';
import {
	buildMilestoneBlock,
	daysSinceAchieved,
	formatMilestoneDate,
	splitMilestones,
	readMilestoneRecord,
	mergeMilestoneRecord,
	milestoneFromGoal,
	MAX_BACKGROUND_MILESTONES,
	MAX_LEDGER_CHARS,
	MILESTONE_FRESH_DAYS,
	type Milestone
} from './milestone';

const NOW = new Date('2026-09-19T08:00:00Z');

function milestone(over: Partial<Milestone> & { id: string; title: string }): Milestone {
	return { achievedOn: null, ...over };
}

describe('daysSinceAchieved', () => {
	it('teller hele dager', () => {
		expect(daysSinceAchieved('2026-09-19', NOW)).toBe(0);
		expect(daysSinceAchieved('2026-09-14', NOW)).toBe(5);
		expect(daysSinceAchieved('2025-09-19', NOW)).toBe(365);
	});

	it('gir null for manglende og ugyldig dato — vi gjetter aldri', () => {
		expect(daysSinceAchieved(null, NOW)).toBeNull();
		expect(daysSinceAchieved('', NOW)).toBeNull();
		expect(daysSinceAchieved('september 2026', NOW)).toBeNull();
		expect(daysSinceAchieved('2026-13-01', NOW)).toBeNull();
	});

	it('gir negative dager for en dato fram i tid', () => {
		expect(daysSinceAchieved('2026-09-25', NOW)).toBe(-6);
	});
});

describe('formatMilestoneDate', () => {
	it('gir full dato ferskt og måned+år som bakgrunn', () => {
		expect(formatMilestoneDate('2026-09-14', false)).toBe('14. september 2026');
		expect(formatMilestoneDate('2026-03-02', true)).toBe('mars 2026');
	});

	it('gir tom streng uten dato', () => {
		expect(formatMilestoneDate(null, false)).toBe('');
	});
});

describe('splitMilestones', () => {
	it('skiller ferske fra bakgrunn på vindusgrensa', () => {
		const fersk = milestone({ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14' });
		const gammel = milestone({ id: 'b', title: 'Ned til 95 kg', achievedOn: '2026-03-02' });
		const { fresh, background } = splitMilestones([gammel, fersk], NOW);
		expect(fresh.map((m) => m.id)).toEqual(['a']);
		expect(background.map((m) => m.id)).toEqual(['b']);
	});

	it('regner dagen på grensa som fersk', () => {
		const achieved = new Date(Date.UTC(2026, 8, 19 - MILESTONE_FRESH_DAYS))
			.toISOString()
			.slice(0, 10);
		const { fresh } = splitMilestones([milestone({ id: 'a', title: 'A', achievedOn: achieved })], NOW);
		expect(fresh).toHaveLength(1);
	});

	// Uten denne regelen blir hele historikken annonsert som fersk den dagen
	// milepælsregnskapet deployes — mål fullført for to år siden har ingen dato.
	it('legger udaterte milepæler i bakgrunn, aldri blant de ferske', () => {
		const { fresh, background } = splitMilestones([milestone({ id: 'a', title: 'Gammelt mål' })], NOW);
		expect(fresh).toHaveLength(0);
		expect(background.map((m) => m.id)).toEqual(['a']);
	});

	it('sorterer bakgrunn nyeste først, med udaterte sist', () => {
		const rows = [
			milestone({ id: 'udatert', title: 'Udatert' }),
			milestone({ id: 'eldst', title: 'Eldst', achievedOn: '2024-01-05' }),
			milestone({ id: 'nyest', title: 'Nyest', achievedOn: '2026-05-05' })
		];
		const { background } = splitMilestones(rows, NOW);
		expect(background.map((m) => m.id)).toEqual(['nyest', 'eldst', 'udatert']);
	});

	it('sorterer ferske nyeste først', () => {
		const rows = [
			milestone({ id: 'b', title: 'B', achievedOn: '2026-09-02' }),
			milestone({ id: 'a', title: 'A', achievedOn: '2026-09-17' })
		];
		expect(splitMilestones(rows, NOW).fresh.map((m) => m.id)).toEqual(['a', 'b']);
	});

	it('kapper bakgrunnslista', () => {
		const rows = Array.from({ length: MAX_BACKGROUND_MILESTONES + 4 }, (_, i) =>
			milestone({ id: `m${i}`, title: `M${i}`, achievedOn: `202${i % 5}-01-0${(i % 9) + 1}` })
		);
		expect(splitMilestones(rows, NOW).background).toHaveLength(MAX_BACKGROUND_MILESTONES);
	});

	it('regner en dato fram i tid som fersk — en skrivefeil skal være synlig', () => {
		const { fresh } = splitMilestones(
			[milestone({ id: 'a', title: 'A', achievedOn: '2026-12-24' })],
			NOW
		);
		expect(fresh).toHaveLength(1);
	});
});

describe('buildMilestoneBlock', () => {
	it('gir tom streng uten milepæler', () => {
		expect(buildMilestoneBlock([], NOW)).toBe('');
	});

	it('rendrer regnskapet når det finnes', () => {
		const block = buildMilestoneBlock(
			[
				milestone({
					id: 'a',
					title: 'Skifte jobb',
					achievedOn: '2026-09-14',
					frees: 'mindre belastning fra jobbsøking',
					cost: 'spenning på gammel jobb'
				})
			],
			NOW
		);
		expect(block).toContain('- Skifte jobb (14. september 2026).');
		expect(block).toContain('Frigjør: mindre belastning fra jobbsøking');
		expect(block).toContain('Kostet: spenning på gammel jobb');
	});

	it('utelater halvdelen som mangler framfor å gjette', () => {
		const block = buildMilestoneBlock(
			[milestone({ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14', frees: 'ro' })],
			NOW
		);
		expect(block).toContain('Frigjør: ro');
		expect(block).not.toContain('Kostet');
	});

	it('skiller seksjonene og bruker grov dato i bakgrunn', () => {
		const block = buildMilestoneBlock(
			[
				milestone({ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14' }),
				milestone({ id: 'b', title: 'Ned til 95 kg', achievedOn: '2026-03-02' })
			],
			NOW
		);
		expect(block).toContain('NYLIG OPPNÅDD');
		expect(block).toContain('OPPNÅDD TIDLIGERE (bakgrunn)');
		expect(block).toContain('Ned til 95 kg (mars 2026)');
		expect(block.indexOf('NYLIG OPPNÅDD')).toBeLessThan(block.indexOf('OPPNÅDD TIDLIGERE'));
	});

	it('sier at milepæler ikke skal åpne et svar', () => {
		const block = buildMilestoneBlock(
			[milestone({ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14' })],
			NOW
		);
		expect(block).toContain('Åpne aldri et svar med en av dem');
		expect(block).toContain('ikke prestasjoner å gratulere med');
	});

	// Den utløsende saken: visjonsprosaen sier fortsatt «jeg vil ut av jobben»
	// lenge etter at jobben er byttet, og prosaen har høyeste troverdighet i prompten.
	it('ber modellen si fra når prosaen er utdatert av en milepæl', () => {
		const block = buildMilestoneBlock(
			[milestone({ id: 'a', title: 'Skifte jobb', achievedOn: '2026-09-14' })],
			NOW
		);
		expect(block).toContain('er prosaen utdatert');
	});
});

describe('readMilestoneRecord', () => {
	it('leser feltene', () => {
		expect(
			readMilestoneRecord({ milestone: { achievedOn: '2026-09-14', frees: 'ro', cost: 'spenning' } })
		).toEqual({ achievedOn: '2026-09-14', frees: 'ro', cost: 'spenning' });
	});

	it('gir null uten milepæl', () => {
		expect(readMilestoneRecord(null)).toBeNull();
		expect(readMilestoneRecord({})).toBeNull();
		expect(readMilestoneRecord({ milestone: 'i går' })).toBeNull();
	});

	it('forkaster en ugyldig dato framfor å bære den videre', () => {
		expect(readMilestoneRecord({ milestone: { achievedOn: 'i fjor' } })).toEqual({});
	});
});

describe('mergeMilestoneRecord', () => {
	// Datoen sier når det SKJEDDE, ikke når noen sist trykket.
	it('setter achievedOn én gang og lar den stå ved senere endringer', () => {
		const first = mergeMilestoneRecord(null, {}, '2026-09-14');
		expect(first).toEqual({ ok: true, record: { achievedOn: '2026-09-14' } });

		const later = mergeMilestoneRecord({ achievedOn: '2026-09-14' }, { frees: 'ro' }, '2026-09-19');
		expect(later).toEqual({ ok: true, record: { achievedOn: '2026-09-14', frees: 'ro' } });
	});

	it('lar en eksplisitt dato rette den lagrede', () => {
		const res = mergeMilestoneRecord({ achievedOn: '2026-09-14' }, { achievedOn: '2026-08-01' }, '2026-09-19');
		expect(res).toEqual({ ok: true, record: { achievedOn: '2026-08-01' } });
	});

	it('beholder felter som ikke er med i patchen', () => {
		const res = mergeMilestoneRecord(
			{ achievedOn: '2026-09-14', frees: 'ro', cost: 'spenning' },
			{ cost: 'ny pris' },
			'2026-09-19'
		);
		expect(res).toEqual({
			ok: true,
			record: { achievedOn: '2026-09-14', frees: 'ro', cost: 'ny pris' }
		});
	});

	// Uten dette kan et felt aldri tømmes igjen — samme regel som dagsmålene i ernæring.
	it('tømmer et felt på tom streng og på null', () => {
		const tom = mergeMilestoneRecord({ achievedOn: '2026-09-14', frees: 'ro' }, { frees: '  ' }, '2026-09-19');
		expect(tom).toEqual({ ok: true, record: { achievedOn: '2026-09-14' } });

		const nullet = mergeMilestoneRecord({ achievedOn: '2026-09-14', cost: 'x' }, { cost: null }, '2026-09-19');
		expect(nullet).toEqual({ ok: true, record: { achievedOn: '2026-09-14' } });
	});

	it('avviser for lange felt med lengden i meldingen', () => {
		const res = mergeMilestoneRecord(null, { frees: 'a'.repeat(MAX_LEDGER_CHARS + 1) }, '2026-09-19');
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain(String(MAX_LEDGER_CHARS + 1));
	});

	it('avviser en ugyldig eksplisitt dato', () => {
		const res = mergeMilestoneRecord(null, { achievedOn: '14.09.2026' }, '2026-09-19');
		expect(res.ok).toBe(false);
	});
});

describe('milestoneFromGoal', () => {
	it('leser milepælen av målet', () => {
		expect(
			milestoneFromGoal({
				id: 'g1',
				title: 'Skifte jobb',
				metadata: { visionHorizon: 'vision_yearly', milestone: { achievedOn: '2026-09-14', frees: 'ro' } }
			})
		).toEqual({ id: 'g1', title: 'Skifte jobb', achievedOn: '2026-09-14', frees: 'ro', cost: null });
	});

	it('gir udatert milepæl for et mål fullført før regnskapet fantes', () => {
		expect(milestoneFromGoal({ id: 'g2', title: 'Gammelt mål', metadata: null })).toEqual({
			id: 'g2',
			title: 'Gammelt mål',
			achievedOn: null,
			frees: null,
			cost: null
		});
	});
});
