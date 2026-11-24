// Handleforslag: hva uka trenger, minus det som faktisk ligger hjemme.
//
// Fram til november 2026 leste handlelista lageret som ja/nei — fantes navnet,
// forsvant varen fra lista, uansett mengde og uansett om noen hadde sett i
// skapet siden i sommer. Nå regnes det i mengder, lageret har en dato for når det
// sist ble bekreftet, og en usikker beholdning sies med ord framfor å gjettes.
// Se docs/changelog/2026-11-24-middagsplanen-som-fasit.md.

import { normalizeIngredientName } from './oda';
import { fromBase, toBase, type BaseUnit } from './units';

/**
 * Hvor lenge en lagerbekreftelse holder. Etter dette sier handlelista «sjekk»
 * framfor å stole på tallet. To uker er én handlerunde med margin: en vare man
 * bekreftet forrige søndag er fortsatt troverdig, en fra forrige måned er det ikke.
 */
export const PANTRY_STALE_DAYS = 14;

export type MealNeed = {
	name: string;
	/** Mengde ALLEREDE skalert til planens porsjoner. null = oppskriften sier ingen mengde. */
	quantity: number | null;
	unit: string | null;
	/** Retten behovet kommer fra. */
	source: string;
};

export type StockItem = {
	name: string;
	quantity: number | null;
	unit: string | null;
	/** Sist noen bekreftet at tallet stemmer. null = aldri. */
	confirmedAt: Date | string | null;
	expiresAt: string | null;
	isStaple: boolean;
	/** Ønsket buffer («ett brød i fryseren»). null = ingen buffer. */
	targetQuantity: number | null;
};

export type ShoppingSuggestion = {
	name: string;
	normalizedName: string;
	quantity: number | null;
	unit: string | null;
	sources: string[];
	/** Beholdningen er ukjent, gammel eller i en annen enhet — sjekk før du kjøper. */
	uncertain: boolean;
	/** Hvorfor varen står der, eller hvorfor den er usikker. */
	note: string | null;
};

export type CoveredNeed = { name: string; note: string };

const DAY_MS = 86_400_000;

/** Hele dager siden beholdningen sist ble bekreftet, eller null om den aldri er det. */
export function stockAgeDays(confirmedAt: Date | string | null, now: Date): number | null {
	if (!confirmedAt) return null;
	const t = new Date(confirmedAt).getTime();
	if (!Number.isFinite(t)) return null;
	return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/** Er bekreftelsen for gammel til å stole på? En aldri bekreftet vare er det alltid. */
export function isStockStale(confirmedAt: Date | string | null, now: Date): boolean {
	const age = stockAgeDays(confirmedAt, now);
	return age == null || age > PANTRY_STALE_DAYS;
}

/** «i dag», «i går», «for 5 dager siden», «for 3 uker siden», «aldri». */
export function describeStockAge(confirmedAt: Date | string | null, now: Date): string {
	const age = stockAgeDays(confirmedAt, now);
	if (age == null) return 'aldri bekreftet';
	if (age === 0) return 'bekreftet i dag';
	if (age === 1) return 'bekreftet i går';
	if (age < 14) return `bekreftet for ${age} dager siden`;
	if (age < 60) return `bekreftet for ${Math.round(age / 7)} uker siden`;
	return `bekreftet for ${Math.round(age / 30)} måneder siden`;
}

function formatAmount(amount: number, base: BaseUnit): string {
	const { quantity, unit } = fromBase(amount, base);
	const num = String(quantity).replace('.', ',');
	return unit ? `${num} ${unit}` : num;
}

type NeedGroup = {
	name: string;
	key: string;
	sources: string[];
	/** Sum per grunnenhet. Mer enn én nøkkel betyr ulike enheter som ikke kan legges sammen. */
	byBase: Map<BaseUnit, number>;
	/** Minst én rett nevner varen uten mengde. */
	unquantified: boolean;
};

function groupNeeds(needs: readonly MealNeed[]): NeedGroup[] {
	const groups = new Map<string, NeedGroup>();
	for (const need of needs) {
		const key = normalizeIngredientName(need.name);
		if (!key) continue;
		const group: NeedGroup = groups.get(key) ?? {
			name: need.name,
			key,
			sources: [],
			byBase: new Map(),
			unquantified: false
		};
		if (!group.sources.includes(need.source)) group.sources.push(need.source);
		if (need.quantity == null || !Number.isFinite(need.quantity)) {
			group.unquantified = true;
		} else {
			const { amount, base } = toBase(need.quantity, need.unit);
			group.byBase.set(base, (group.byBase.get(base) ?? 0) + amount);
		}
		groups.set(key, group);
	}
	return [...groups.values()];
}

type StockGroup = {
	rows: StockItem[];
	/** Kjent beholdning per grunnenhet; null = minst én rad uten mengde. */
	byBase: Map<BaseUnit, number> | null;
	stale: boolean;
	oldestConfirmed: Date | string | null;
	buffer: { amount: number; base: BaseUnit } | null;
};

function groupStock(stock: readonly StockItem[], todayIso: string, now: Date): Map<string, StockGroup> {
	const out = new Map<string, StockGroup>();
	for (const row of stock) {
		const key = normalizeIngredientName(row.name);
		if (!key) continue;
		const group: StockGroup = out.get(key) ?? { rows: [], byBase: new Map(), stale: false, oldestConfirmed: row.confirmedAt, buffer: null };
		group.rows.push(row);
		if (row.isStaple && row.targetQuantity != null && row.targetQuantity > 0) {
			group.buffer = toBase(row.targetQuantity, row.unit);
		}
		const expired = row.expiresAt != null && row.expiresAt < todayIso;
		if (!expired) {
			if (row.quantity == null) group.byBase = null;
			else if (group.byBase) {
				const { amount, base } = toBase(row.quantity, row.unit);
				group.byBase.set(base, (group.byBase.get(base) ?? 0) + amount);
			}
		}
		if (isStockStale(row.confirmedAt, now)) group.stale = true;
		const older =
			row.confirmedAt == null ||
			(group.oldestConfirmed != null && new Date(row.confirmedAt) < new Date(group.oldestConfirmed));
		if (older) group.oldestConfirmed = row.confirmedAt;
		out.set(key, group);
	}
	return out;
}

/**
 * Hva skal kjøpes? Behovene fra ukas retter (summert på tvers av retter, i felles
 * enhet), minus lageret, pluss det som mangler for å holde bufferen på basisvarer.
 *
 * Regelen for usikkerhet er asymmetrisk med vilje: en vare vi tror finnes, men
 * ikke vet om, legges på lista MERKET framfor å utelates. Å kjøpe en ekstra pakke
 * kjøttdeig koster lite; å stå uten middag fordi lista stolte på et tall fra
 * august koster en kveld.
 */
export function planShopping(input: {
	needs: readonly MealNeed[];
	stock: readonly StockItem[];
	now: Date;
	todayIso: string;
}): { items: ShoppingSuggestion[]; covered: CoveredNeed[] } {
	const { now, todayIso } = input;
	const stockByKey = groupStock(input.stock, todayIso, now);
	const items: ShoppingSuggestion[] = [];
	const covered: CoveredNeed[] = [];
	const handled = new Set<string>();

	const push = (s: Omit<ShoppingSuggestion, 'normalizedName'>, key: string) =>
		items.push({ ...s, normalizedName: key });

	for (const need of groupNeeds(input.needs)) {
		handled.add(need.key);
		const stock = stockByKey.get(need.key);
		const bases = [...need.byBase.keys()];
		const single = bases.length === 1 && !need.unquantified ? bases[0] : null;
		const needAmount = single ? need.byBase.get(single)! : null;
		const needText = single && needAmount != null ? fromBase(needAmount, single) : { quantity: null, unit: null };
		const age = stock ? ageText(stock, now) : '';

		if (!stock) {
			push(
				{
					name: need.name,
					quantity: needText.quantity,
					unit: needText.unit,
					sources: need.sources,
					uncertain: false,
					note: bases.length > 1 ? 'Rettene oppgir mengden i ulike enheter' : null
				},
				need.key
			);
			continue;
		}

		// Beholdning uten mengde: «vi har noe». Fersk bekreftelse holder, gammel gjør det ikke.
		if (stock.byBase === null) {
			if (stock.stale) {
				push(
					{ ...needText, name: need.name, sources: need.sources, uncertain: true, note: `Finnes hjemme, men mengden er ukjent (${age})` },
					need.key
				);
			} else {
				covered.push({ name: need.name, note: `Finnes hjemme (${age})` });
			}
			continue;
		}

		const bufferAmount = stock.buffer && single && stock.buffer.base === single ? stock.buffer.amount : 0;
		const haveBases = [...stock.byBase.keys()];
		const have = single ? (stock.byBase.get(single) ?? 0) : null;
		const haveText = haveBases.length === 1 ? formatAmount(stock.byBase.get(haveBases[0])!, haveBases[0]) : null;

		// Rettene sier ingen (felles) mengde: alt over null regnes som nok.
		if (!single) {
			const total = [...stock.byBase.values()].reduce((a, b) => a + b, 0);
			if (total > 0 && !stock.stale) {
				covered.push({ name: need.name, note: `Har ${haveText ?? 'noe'} hjemme (${age})` });
			} else {
				push(
					{
						name: need.name,
						quantity: null,
						unit: null,
						sources: need.sources,
						uncertain: total > 0,
						note: total > 0 ? `Har ${haveText ?? 'noe'} hjemme, men ${age}` : null
					},
					need.key
				);
			}
			continue;
		}

		// Enheten i lageret passer ikke med rettenes — tallene kan ikke trekkes fra hverandre.
		if (have === 0 && haveBases.length > 0 && !haveBases.includes(single)) {
			push(
				{
					name: need.name,
					quantity: needText.quantity,
					unit: needText.unit,
					sources: need.sources,
					uncertain: true,
					note: `Lageret har ${haveText ?? 'noe'}, i en annen enhet enn oppskriften`
				},
				need.key
			);
			continue;
		}

		const rest = needAmount! + bufferAmount - have!;
		if (rest <= 0) {
			if (stock.stale) {
				push(
					{
						name: need.name,
						quantity: null,
						unit: null,
						sources: need.sources,
						uncertain: true,
						note: `Trolig nok hjemme (${haveText}), men ${age}`
					},
					need.key
				);
			} else {
				covered.push({ name: need.name, note: `Nok hjemme (${haveText})` });
			}
			continue;
		}

		const restText = fromBase(rest, single);
		const notes: string[] = [];
		if (have! > 0) notes.push(`har ${haveText} hjemme`);
		if (bufferAmount > 0) notes.push(`inkl. buffer på ${formatAmount(bufferAmount, single)}`);
		if (stock.stale && have! > 0) notes.push(age);
		push(
			{
				name: need.name,
				quantity: restText.quantity,
				unit: restText.unit,
				sources: bufferAmount > 0 ? [...need.sources, 'buffer'] : need.sources,
				uncertain: stock.stale && have! > 0,
				note: notes.length ? capitalize(notes.join(', ')) : null
			},
			need.key
		);
	}

	// Basisvarer ingen rett trenger denne uka: buffer og tomme faste varer.
	for (const [key, stock] of stockByKey) {
		if (handled.has(key)) continue;
		const row = stock.rows[0];
		if (!stock.rows.some((r) => r.isStaple)) continue;
		const age = ageText(stock, now);

		if (stock.buffer) {
			const { amount: target, base } = stock.buffer;
			const have = stock.byBase ? (stock.byBase.get(base) ?? 0) : null;
			if (have == null) {
				push(
					{
						name: row.name,
						quantity: null,
						unit: null,
						sources: ['buffer'],
						uncertain: true,
						note: `Ønsker ${formatAmount(target, base)} hjemme — mengden er ikke registrert`
					},
					key
				);
				continue;
			}
			const rest = target - have;
			if (rest > 0) {
				const restText = fromBase(rest, base);
				push(
					{
						name: row.name,
						quantity: restText.quantity,
						unit: restText.unit,
						sources: ['buffer'],
						uncertain: stock.stale && have > 0,
						note: `Ønsker ${formatAmount(target, base)} hjemme, har ${formatAmount(have, base)}${stock.stale && have > 0 ? ` (${age})` : ''}`
					},
					key
				);
			} else if (stock.stale) {
				push(
					{
						name: row.name,
						quantity: null,
						unit: null,
						sources: ['buffer'],
						uncertain: true,
						note: `Bufferen ser full ut, men ${age}`
					},
					key
				);
			}
			continue;
		}

		// Fast vare uten buffer: på lista når den er tom eller utgått (regelen fra før).
		const empty = stock.byBase !== null && [...stock.byBase.values()].every((v) => v <= 0);
		if (empty) {
			push({ name: row.name, quantity: null, unit: null, sources: ['fast vare'], uncertain: false, note: null }, key);
		}
	}

	return { items, covered };
}

function ageText(stock: StockGroup, now: Date): string {
	return describeStockAge(stock.oldestConfirmed, now);
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Bygg behovene fra ukas planer: skaler hver ingrediens fra oppskriftens porsjoner
 * til planens. Droppede planer bærer ikke behov — en middag som ikke blir laget
 * skal ikke handles inn.
 */
export function needsFromPlans(
	plans: ReadonlyArray<{ mealId: string | null; servings: number; status?: string | null }>,
	mealsById: Map<
		string,
		{ title: string; servings: number; ingredients: Array<{ name: string; quantity?: number | null; unit?: string | null; optional?: boolean }> }
	>,
	opts: { includeOptional?: boolean } = {}
): MealNeed[] {
	const out: MealNeed[] = [];
	for (const plan of plans) {
		if (!plan.mealId || plan.status === 'skipped') continue;
		const meal = mealsById.get(plan.mealId);
		if (!meal) continue;
		const scale = meal.servings > 0 ? plan.servings / meal.servings : 1;
		for (const ing of meal.ingredients) {
			if (ing.optional && !opts.includeOptional) continue;
			if (!ing.name?.trim()) continue;
			out.push({
				name: ing.name,
				quantity: ing.quantity != null && Number.isFinite(Number(ing.quantity)) ? Number(ing.quantity) * scale : null,
				unit: ing.unit ?? null,
				source: meal.title
			});
		}
	}
	return out;
}
