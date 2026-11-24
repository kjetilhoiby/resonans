import { describe, it, expect } from 'vitest';
import {
	describeStockAge,
	isStockStale,
	needsFromPlans,
	planShopping,
	PANTRY_STALE_DAYS,
	type MealNeed,
	type StockItem
} from './shopping-needs';
import { fromBase, normalizeUnit, scaleQuantity, toBase } from './units';

const NOW = new Date('2026-11-24T12:00:00Z');
const TODAY = '2026-11-24';
const FRESH = '2026-11-20T10:00:00Z';
const OLD = '2026-10-01T10:00:00Z';

function stock(partial: Partial<StockItem> & Pick<StockItem, 'name'>): StockItem {
	return {
		quantity: null,
		unit: null,
		confirmedAt: FRESH,
		expiresAt: null,
		isStaple: false,
		targetQuantity: null,
		...partial
	};
}

function need(name: string, quantity: number | null, unit: string | null, source: string): MealNeed {
	return { name, quantity, unit, source };
}

describe('enheter', () => {
	it('regner vekt og volum til felles grunnenhet', () => {
		expect(toBase(0.5, 'kg')).toEqual({ amount: 500, base: 'g' });
		expect(toBase(2, 'dl')).toEqual({ amount: 200, base: 'ml' });
		expect(normalizeUnit(null).base).toBe('stk');
	});

	it('blander aldri vekt og volum', () => {
		expect(normalizeUnit('dl').base).not.toBe(normalizeUnit('g').base);
	});

	it('en ukjent enhet er bare lik seg selv', () => {
		expect(normalizeUnit('Boks')).toEqual({ base: 'boks', factor: 1 });
	});

	it('skriver mengder tilbake lesbart', () => {
		expect(fromBase(1500, 'g')).toEqual({ quantity: 1.5, unit: 'kg' });
		expect(fromBase(250, 'ml')).toEqual({ quantity: 2.5, unit: 'dl' });
		expect(fromBase(3, 'stk')).toEqual({ quantity: 3, unit: null });
	});

	it('skalerer antall opp til halve, ikke til desimaler ingen kan kjøpe', () => {
		expect(scaleQuantity(1, null, 2, 5)).toBe(2.5);
		expect(scaleQuantity(1, 'stk', 4, 5)).toBe(1.5);
		expect(scaleQuantity(400, 'g', 4, 5)).toBe(500);
		expect(scaleQuantity(null, 'g', 4, 5)).toBeNull();
	});
});

describe('lagerets alder', () => {
	it('en vare som aldri er bekreftet er alltid usikker', () => {
		expect(isStockStale(null, NOW)).toBe(true);
		expect(describeStockAge(null, NOW)).toBe('aldri bekreftet');
	});

	it('to uker holder, tre gjør det ikke', () => {
		expect(isStockStale(new Date(NOW.getTime() - PANTRY_STALE_DAYS * 86_400_000), NOW)).toBe(false);
		expect(isStockStale(OLD, NOW)).toBe(true);
	});

	it('sier alderen med ord', () => {
		expect(describeStockAge(NOW, NOW)).toBe('bekreftet i dag');
		expect(describeStockAge(FRESH, NOW)).toBe('bekreftet for 4 dager siden');
		expect(describeStockAge(OLD, NOW)).toBe('bekreftet for 8 uker siden');
	});
});

describe('planShopping', () => {
	it('summerer samme vare på tvers av retter, også i ulike enheter', () => {
		const { items } = planShopping({
			needs: [need('Kjøttdeig', 400, 'g', 'Taco'), need('kjøttdeig', 0.5, 'kg', 'Lasagne')],
			stock: [],
			now: NOW,
			todayIso: TODAY
		});
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ quantity: 900, unit: 'g', sources: ['Taco', 'Lasagne'], uncertain: false });
	});

	it('trekker fra det som ligger hjemme, ikke hele varen', () => {
		const { items } = planShopping({
			needs: [need('Kjøttdeig', 400, 'g', 'Taco'), need('Kjøttdeig', 400, 'g', 'Lasagne')],
			stock: [stock({ name: 'kjøttdeig', quantity: 400, unit: 'g' })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items[0]).toMatchObject({ quantity: 400, unit: 'g', uncertain: false });
		expect(items[0].note).toMatch(/har 400 g hjemme/i);
	});

	it('nok hjemme og nylig bekreftet: står ikke på lista', () => {
		const { items, covered } = planShopping({
			needs: [need('Ris', 300, 'g', 'Curry')],
			stock: [stock({ name: 'Ris', quantity: 1, unit: 'kg' })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items).toHaveLength(0);
		expect(covered).toHaveLength(1);
	});

	it('nok hjemme, men bekreftet for lenge siden: på lista som usikker', () => {
		const { items } = planShopping({
			needs: [need('Ris', 200, 'g', 'Curry')],
			stock: [stock({ name: 'Ris', quantity: 1, unit: 'kg', confirmedAt: OLD })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items[0]).toMatchObject({ uncertain: true, quantity: null });
		expect(items[0].note).toMatch(/Trolig nok hjemme .* bekreftet for 8 uker siden/);
	});

	it('mengde ikke registrert: fersk bekreftelse holder, gammel gjør det ikke', () => {
		const fresh = planShopping({
			needs: [need('Salt', 1, 'ts', 'Suppe')],
			stock: [stock({ name: 'Salt' })],
			now: NOW,
			todayIso: TODAY
		});
		expect(fresh.items).toHaveLength(0);

		const old = planShopping({
			needs: [need('Salt', 1, 'ts', 'Suppe')],
			stock: [stock({ name: 'Salt', confirmedAt: OLD })],
			now: NOW,
			todayIso: TODAY
		});
		expect(old.items[0].uncertain).toBe(true);
	});

	it('lager i en annen dimensjon enn oppskriften: kjøp, men merk usikker', () => {
		const { items } = planShopping({
			needs: [need('Melk', 5, 'dl', 'Grøt')],
			stock: [stock({ name: 'Melk', quantity: 2, unit: 'stk' })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items[0]).toMatchObject({ quantity: 5, unit: 'dl', uncertain: true });
	});

	it('utgått vare teller ikke som beholdning', () => {
		const { items } = planShopping({
			needs: [need('Rømme', 3, 'dl', 'Taco')],
			stock: [stock({ name: 'Rømme', quantity: 3, unit: 'dl', expiresAt: '2026-11-20' })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items[0]).toMatchObject({ quantity: 3, unit: 'dl' });
	});

	it('buffer på en basisvare: fyll opp til ønsket mengde', () => {
		const { items } = planShopping({
			needs: [],
			stock: [stock({ name: 'Brød', quantity: 0, unit: null, isStaple: true, targetQuantity: 1 })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items[0]).toMatchObject({ name: 'Brød', quantity: 1, sources: ['buffer'] });
		expect(items[0].note).toMatch(/Ønsker 1 hjemme, har 0/);
	});

	it('buffer kommer i tillegg til det rettene bruker', () => {
		const { items } = planShopping({
			needs: [need('Brød', 1, null, 'Suppe med brød')],
			stock: [stock({ name: 'Brød', quantity: 1, isStaple: true, targetQuantity: 1 })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items[0]).toMatchObject({ quantity: 1, sources: ['Suppe med brød', 'buffer'] });
	});

	it('full buffer og fersk bekreftelse: ingenting å kjøpe', () => {
		const { items } = planShopping({
			needs: [],
			stock: [stock({ name: 'Brød', quantity: 2, isStaple: true, targetQuantity: 1 })],
			now: NOW,
			todayIso: TODAY
		});
		expect(items).toHaveLength(0);
	});

	it('fast vare uten buffer: på lista bare når den er tom', () => {
		const empty = planShopping({
			needs: [],
			stock: [stock({ name: 'Epler', quantity: 0, isStaple: true })],
			now: NOW,
			todayIso: TODAY
		});
		expect(empty.items[0]).toMatchObject({ name: 'Epler', sources: ['fast vare'] });

		const full = planShopping({
			needs: [],
			stock: [stock({ name: 'Epler', quantity: 6, isStaple: true })],
			now: NOW,
			todayIso: TODAY
		});
		expect(full.items).toHaveLength(0);
	});
});

describe('needsFromPlans', () => {
	const meals = new Map([
		['m1', { title: 'Taco', servings: 4, ingredients: [{ name: 'Kjøttdeig', quantity: 400, unit: 'g' }, { name: 'Koriander', optional: true }] }]
	]);

	it('skalerer til planens porsjoner', () => {
		const needs = needsFromPlans([{ mealId: 'm1', servings: 5 }], meals);
		expect(needs).toEqual([{ name: 'Kjøttdeig', quantity: 500, unit: 'g', source: 'Taco' }]);
	});

	it('en droppet middag handles ikke inn', () => {
		expect(needsFromPlans([{ mealId: 'm1', servings: 5, status: 'skipped' }], meals)).toEqual([]);
	});
});
