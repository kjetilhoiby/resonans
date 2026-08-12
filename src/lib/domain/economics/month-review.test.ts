import { describe, it, expect } from 'vitest';
import {
	assessMonthAhead,
	findUnusualCategories,
	pickOneThing,
	DEVIATION_FLOOR_KR,
	MIN_MONTHS_FOR_DEVIATION,
	MIN_PERIODS_FOR_FORECAST,
	type ActionCandidate,
	type CategoryHistory
} from './month-review';

/**
 * `toLocaleString('nb-NO')` skiller tusener med et HARDT mellomrom (U+00A0), ikke et
 * vanlig. En assertion på «4 200 kr» skrevet med vanlig mellomrom feiler derfor selv når
 * teksten er riktig — så tekstsjekker går gjennom denne.
 */
function plain(text: string): string {
	return text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('assessMonthAhead', () => {
	const solid = {
		income: 46_000,
		fixedCosts: 22_000,
		variableCostsPerPeriod: 18_000,
		periodsObserved: 4
	};

	it('sier at måneden bærer, med marginen', () => {
		const result = assessMonthAhead(solid);

		expect(result.carries).toBe(true);
		expect(result.margin).toBe(6000);
		expect(plain(result.reason)).toContain('6 000 kr');
	});

	it('sier at den ikke bærer, og hvor mye som mangler', () => {
		const result = assessMonthAhead({ ...solid, variableCostsPerPeriod: 30_000 });

		expect(result.carries).toBe(false);
		expect(result.margin).toBe(-6000);
		expect(plain(result.reason)).toContain('mangler 6 000 kr');
	});

	it('nevner bufferen bare når måneden IKKE bærer', () => {
		const short = assessMonthAhead({
			...solid,
			variableCostsPerPeriod: 30_000,
			bufferRunwayMonths: 3
		});
		const fine = assessMonthAhead({ ...solid, bufferRunwayMonths: 3 });

		// Bufferen er svaret på «hva skjer da», ikke på «går det bra».
		expect(short.reason).toContain('Bufferen dekker');
		expect(fine.reason).not.toContain('Bufferen');
	});

	it('returnerer null, IKKE false, uten lønn', () => {
		// «Vi vet ikke» og «måneden bærer ikke» er helt ulike beskjeder.
		const result = assessMonthAhead({ ...solid, income: null });

		expect(result.carries).toBeNull();
		expect(result.margin).toBeNull();
		expect(result.reason).toContain('Ingen lønnsutbetaling');
	});

	it('returnerer null uten fast/variabelt-splitt', () => {
		expect(assessMonthAhead({ ...solid, fixedCosts: null }).carries).toBeNull();
		expect(assessMonthAhead({ ...solid, variableCostsPerPeriod: null }).carries).toBeNull();
	});

	it('holder kjeft på for tynt historikkgrunnlag', () => {
		const result = assessMonthAhead({ ...solid, periodsObserved: 1 });

		expect(result.carries).toBeNull();
		expect(result.reason).toContain(String(MIN_PERIODS_FOR_FORECAST));
	});

	it('kaller nøyaktig balanse for «bærer»', () => {
		const result = assessMonthAhead({ ...solid, variableCostsPerPeriod: 24_000 });

		expect(result.margin).toBe(0);
		expect(result.carries).toBe(true);
	});
});

describe('findUnusualCategories', () => {
	function history(
		category: string,
		current: number,
		previous: number[]
	): CategoryHistory {
		return { category, label: category, emoji: '📦', current, previous };
	}

	it('finner kategorien som skiller seg fra sin egen normal', () => {
		const result = findUnusualCategories([
			history('dagligvarer', 12_000, [8000, 8200, 7900, 8100]),
			history('kafe_og_restaurant', 2100, [2000, 2050, 1950, 2000])
		]);

		expect(result.map((r) => r.category)).toEqual(['dagligvarer']);
		expect(result[0].normal).toBe(8050);
		expect(result[0].direction).toBe('over');
		expect(result[0].reason).toContain('mer');
	});

	it('finner også kategorier som er UVANLIG LAVE', () => {
		// «Hva var uvanlig» er ikke «hvor sprakk budsjettet».
		const result = findUnusualCategories([
			history('reise', 0, [6000, 5800, 6200, 6000])
		]);

		expect(result).toHaveLength(1);
		expect(result[0].direction).toBe('under');
		expect(result[0].reason).toContain('mindre');
	});

	it('krever nok historikk framfor å gjette', () => {
		const result = findUnusualCategories([history('barn', 9000, [1000, 1100])]);

		expect(result).toHaveLength(0);
	});

	it('ignorerer små kroneavvik uansett hvor prosentvis store', () => {
		// En kategori på 200 kr som dobler seg skal ikke konkurrere med husleia.
		const result = findUnusualCategories([history('diverse', 400, [200, 190, 210, 200])]);

		expect(result).toHaveLength(0);
	});

	it('bruker kategoriens EGEN spredning som terskel', () => {
		// Samme kroneavvik (+3 000), men hobby svinger normalt like mye. En fast prosent
		// ville rapportert begge — og da ville de volatile kategoriene dukket opp hver måned.
		const stable = history('faste_boutgifter', 11_000, [8000, 8050, 7950, 8000]);
		const volatile = history('hobby_og_fritid', 11_000, [8000, 3000, 13_000, 5000]);

		const result = findUnusualCategories([stable, volatile]);

		expect(result.map((r) => r.category)).toEqual(['faste_boutgifter']);
	});

	it('sorterer største avvik først', () => {
		const result = findUnusualCategories([
			history('a', 9000, [8000, 8000, 8000, 8000]),
			history('b', 20_000, [8000, 8000, 8000, 8000])
		]);

		expect(result.map((r) => r.category)).toEqual(['b', 'a']);
	});

	it('lar kronegulvet gjelde alene når spredningen er null', () => {
		// Et abonnement på nøyaktig samme beløp hver måned har medianavvik 0. Uten
		// gulvet ville ett øres endring blitt «uvanlig».
		const belowFloor = findUnusualCategories([
			history('medier_og_underholdning', 219 + DEVIATION_FLOOR_KR - 1, [219, 219, 219])
		]);
		const aboveFloor = findUnusualCategories([
			history('medier_og_underholdning', 219 + DEVIATION_FLOOR_KR, [219, 219, 219])
		]);

		expect(belowFloor).toHaveLength(0);
		expect(aboveFloor).toHaveLength(1);
	});

	it('krever minst MIN_MONTHS_FOR_DEVIATION måneder', () => {
		const tooFew = findUnusualCategories([
			history('barn', 20_000, Array(MIN_MONTHS_FOR_DEVIATION - 1).fill(1000))
		]);
		const enough = findUnusualCategories([
			history('barn', 20_000, Array(MIN_MONTHS_FOR_DEVIATION).fill(1000))
		]);

		expect(tooFew).toHaveLength(0);
		expect(enough).toHaveLength(1);
	});
});

describe('pickOneThing', () => {
	function candidate(kind: ActionCandidate['kind'], amountKr: number): ActionCandidate {
		return { kind, amountKr, text: `${kind} ${amountKr}` };
	}

	it('«ingenting» er et gyldig svar', () => {
		// Bevisst gjentakelse av lærdommen fra øktvurderingen: et råd som alltid kommer
		// slutter å bety noe.
		const result = pickOneThing([]);

		expect(result.action).toBeNull();
		expect(result.reason).toContain('også et svar');
	});

	it('velger ÉN, den med størst utslag i kroner', () => {
		const result = pickOneThing([
			candidate('uklassifisert-vipps', 800),
			candidate('kategori-vokser', 4200),
			candidate('over-tak', 1500)
		]);

		expect(result.action?.kind).toBe('kategori-vokser');
		expect(plain(result.reason)).toContain('4 200 kr');
	});

	it('rangerer på kroner, ikke på hvor interessant funnet er', () => {
		const result = pickOneThing([
			candidate('buffer-eroderer', 500),
			candidate('uklassifisert-vipps', 9000)
		]);

		expect(result.action?.kind).toBe('uklassifisert-vipps');
	});
});
