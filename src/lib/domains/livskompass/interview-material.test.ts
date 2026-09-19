import { describe, expect, it } from 'vitest';
import {
	MIN_WEEKS_FOR_PATTERN,
	buildInterviewPatterns,
	describeLivskompassMaterial,
	type InterviewWeek
} from './interview-material';
import {
	resolveDeprioritization,
	type Deprioritization,
	type ResolvedDeprioritization
} from './deprioritization';
import { LIVSKOMPASS_DIMENSIONS, type LivskompassScores } from './dimensions';

/** Alle dimensjoner på nøytrale verdier, med overstyringer per uke. */
function week(id: string, overrides: Record<string, [number, number]>): InterviewWeek {
	const scores: LivskompassScores = {};
	for (const dim of LIVSKOMPASS_DIMENSIONS) {
		const o = overrides[dim.id];
		scores[dim.id] = o ? { importance: o[0], match: o[1] } : { importance: 5, match: 5 };
	}
	return { week: id, scores };
}

function chosen(dimensionId: string, todayKey = '2026-09-19'): ResolvedDeprioritization {
	const period: Deprioritization = {
		id: 'p1',
		dimensionId,
		startDate: '2026-08-10',
		endDate: '2026-11-02',
		reason: 'fokus på jobbskiftet',
		repair: 'en kveld i måneden fra desember',
		confirmedOn: null,
		settledOn: null,
		outcome: null
	};
	return resolveDeprioritization(period, todayKey);
}

describe('buildInterviewPatterns', () => {
	it('teller ute-av-synk-uker og krever nok uker før det kalles vedvarende', () => {
		const weeks = Array.from({ length: 6 }, (_, i) => week(`w${i}`, { venner: [8, 3] }));
		const venner = buildInterviewPatterns(weeks).find((p) => p.dimensionId === 'venner')!;
		expect(venner.weeks).toBe(6);
		expect(venner.weeksOutOfSync).toBe(6);
		expect(venner.persistent).toBe(true);
		expect(venner.importance).toBe(8);
		expect(venner.medianMatch).toBe(3);
	});

	it('kaller ikke én dårlig uke et mønster', () => {
		const weeks = [week('w0', { venner: [8, 2] }), week('w1', {}), week('w2', {})];
		const venner = buildInterviewPatterns(weeks).find((p) => p.dimensionId === 'venner')!;
		expect(venner.weeksOutOfSync).toBe(1);
		expect(venner.persistent).toBe(false);
		expect(weeks.length).toBeLessThan(MIN_WEEKS_FOR_PATTERN);
	});

	it('bruker median, så én ekstremuke ikke flytter bildet', () => {
		const weeks = [
			week('w0', { trening: [8, 6] }),
			week('w1', { trening: [8, 6] }),
			week('w2', { trening: [8, 1] }),
			week('w3', { trening: [8, 6] })
		];
		const trening = buildInterviewPatterns(weeks).find((p) => p.dimensionId === 'trening')!;
		expect(trening.medianMatch).toBe(6);
	});

	it('leser retningen med nyeste uke først — ikke omvendt', () => {
		// Nyest først: samsvaret har STEGET fra 2 til 7.
		const weeks = [
			week('w0', { trening: [9, 7] }),
			week('w1', { trening: [9, 7] }),
			week('w2', { trening: [9, 7] }),
			week('w3', { trening: [9, 2] }),
			week('w4', { trening: [9, 2] }),
			week('w5', { trening: [9, 2] })
		];
		const trening = buildInterviewPatterns(weeks).find((p) => p.dimensionId === 'trening')!;
		expect(trening.trend).toBe('bedre');
	});

	it('har ingen retning før nok uker er målt', () => {
		const weeks = [week('w0', { trening: [9, 7] }), week('w1', { trening: [9, 2] })];
		const trening = buildInterviewPatterns(weeks).find((p) => p.dimensionId === 'trening')!;
		expect(trening.trend).toBeNull();
	});

	it('teller bare uker der dimensjonen faktisk er scoret', () => {
		const tom: InterviewWeek = { week: 'w9', scores: {} };
		const weeks = [week('w0', { venner: [8, 3] }), tom];
		const venner = buildInterviewPatterns(weeks).find((p) => p.dimensionId === 'venner')!;
		expect(venner.weeks).toBe(1);
	});

	it('markerer en dimensjon som er bevisst valgt bort', () => {
		const weeks = Array.from({ length: 5 }, (_, i) => week(`w${i}`, { kultur: [7, 2] }));
		const patterns = buildInterviewPatterns(weeks, [chosen('kultur')]);
		const kultur = patterns.find((p) => p.dimensionId === 'kultur')!;
		expect(kultur.chosen).toBe(true);
		expect(kultur.chosenSentence).toContain('Kultur');
	});
});

describe('describeLivskompassMaterial', () => {
	it('er tom når det verken finnes uker eller vekting', () => {
		expect(describeLivskompassMaterial({ weeks: [] })).toBe('');
		expect(describeLivskompassMaterial({ weeks: [], importance: {} })).toBe('');
	});

	it('faller tilbake på vektingen uten innsjekker — og påstår ingen avvik', () => {
		const text = describeLivskompassMaterial({
			weeks: [],
			importance: { partner: 9, barn: 9, trening: 7 }
		});
		expect(text).toContain('ingen ukesinnsjekker');
		expect(text).toContain('Partner: 9/10');
		expect(text).toContain('ikke påstå noe om avvik');
	});

	it('lister det som har ligget ute av synk, med tall', () => {
		const weeks = Array.from({ length: 8 }, (_, i) => week(`w${i}`, { venner: [8, 3] }));
		const text = describeLivskompassMaterial({ weeks });
		expect(text).toContain('8 uker med ukesinnsjekk');
		expect(text).toContain('Venner (Relasjoner)');
		expect(text).toContain('8 av 8 uker');
		expect(text).toContain('ikke hva det BETYR');
	});

	it('holder tilbake mønster-påstanden under terskelen', () => {
		const weeks = Array.from({ length: 2 }, (_, i) => week(`w${i}`, { venner: [8, 3] }));
		const text = describeLivskompassMaterial({ weeks });
		expect(text).toContain('ikke kall dem et mønster');
	});

	it('skiller et valgt bortfall fra drift, og ber ikke om at det rettes opp', () => {
		const weeks = Array.from({ length: 6 }, (_, i) =>
			week(`w${i}`, { kultur: [7, 2], venner: [8, 3] })
		);
		const text = describeLivskompassMaterial({ weeks, deprioritizations: [chosen('kultur')] });
		expect(text).toContain('Valgt bort i perioden');
		expect(text).toContain('Ikke be brukeren rette opp');
		// Kultur skal ikke også stå blant driftende linjer
		const driftDel = text.slice(0, text.indexOf('Valgt bort'));
		expect(driftDel).not.toContain('Kultur (');
		expect(driftDel).toContain('Venner (');
	});
});
